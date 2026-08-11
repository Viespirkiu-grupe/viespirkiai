import { log } from "../../utils/log.js";
import { sleep } from "../../utils/time.js";
import { parseArgs, numArg } from "../../utils/cliArgs.js";
import { createETarApi, ETarNotFoundError } from "./eTarApi.js";
import { closeSqlite, getETarSidecarStats, openETarSidecar, saveResponse } from "./eTarSidecar.js";
import { fmtBytes } from "../../utils/units.js";
import {
    editionExists,
    ensureScrapeDaysForward,
    getOldestScrapeDay,
    getScrapeStatus,
    markDayScraped,
    markStageDone,
    pickActsToScrape,
    pickDaysToScrape,
    pickEditionsToScrape,
    recordEditionFailure,
    recordFailure,
    saveDocument,
    saveEditionList,
    upsertDiscoveredActs,
} from "./eTarStore.js";

// e-TAR scraper'is virš stateless e-TAR API adapterio.
//
// Penki etapai, kiekvienas su savo žyma DB (žr. "eTarScrapeDay",
// "eTarLegalActScrape", "eTarEdition"."scrapedAt"), tad bet kurį galima nutraukti
// ir tęsti:
//
//   1 dienos   — paieška pagal priėmimo datą → atrandami aktų ID
//   2 acts     — GET /{id}                   → originalus dokumentas
//   3 editions — GET /{id}/editions          → suvestinių redakcijų sąrašas
//   4 asr      — GET /{id}/asr               → galiojanti suvestinė
//   5 istorija — GET /{id}/{edition}         → istorinės suvestinės
//
// `--stage all` visus juos suka LYGIAGREČIAI viename darbininkų baseine, o ne
// vieną po kito: kitaip pirmas dokumentas būtų parsiųstas tik nušlavus visas
// ~5000 dienų. Vienas etapas (`--stage documents`) naudoja tą patį planuoklį,
// tik su viena eile — `--concurrency N` abiem atvejais reiškia tą patį: N darbų
// vienu metu be pertrūkių (žr. runPipeline).
//
// Kiekvieno dokumento/sąrašo atsakymas keliauja į SQLite sidecar'ą
// (/flashas/viespirkiai/eTar), o Postgres'e lieka normalizuota dalis + md5.
// Dienos paieška į sidecar'ą nerašoma — ji tik atranda ID.
//
// Modulis sąmoningai savarankiškas: niekur neregistruotas, į taskų runner'į
// neįtrauktas, senas modules/etar lieka nepaliestas.

const DEFAULT_CONCURRENCY = 4;

/**
 * Viena eilutė vienai užklausai — vienoda visiems etapams:
 *
 *   dok  61e2fe20… patch  842ms (+18ms DB, 14 203 simb., 2 užkl.) Dėl viešųjų…
 *   red  61e2fe20… —      311ms (+2ms DB, 3 red., 1 užkl.)        Dėl viešųjų…
 *
 * `keitimas`: `insert`/`patch` — kas buvo įrašyta, `—` — md5 nepakito, tad DB
 * net neliesta. Taip iš log'o iškart matyti, kiek pravažiavimo yra tikro darbo
 * ir kurie aktai lėti.
 */
function logRequest({ etapas, id, keitimas, fetchMs, dbMs, detalė, pavadinimas }) {
    log(
        `${etapas} ${id} ${(keitimas ?? "—").padEnd(6)} ${String(fetchMs).padStart(5)}ms`
        + ` (+${dbMs}ms DB${detalė ? `, ${detalė}` : ""})`
        + ` ${(pavadinimas ?? "").slice(0, 60)}`,
    );
}

const simboliai = (payload) => {
    const n = payload?.official_text?.text?.length ?? 0;
    return `${n.toLocaleString("lt-LT")} simb.`;
};

/**
 * Kiek užklausų į e-TAR adapteris sudėjo už mūsų vienos. Iš `http_requests` (į
 * sidecar'ą jis nekeliauja, tad matomas tik čia) — iš karto matyti, ar 11 s
 * atsakymas yra vienas lėtas šuolis, ar tuzinas puslapių po sekundę.
 */
const užklausos = (payload) => {
    const n = payload?.http_requests?.length;
    return n ? `${n} užkl.` : null;
};

const detalės = (...dalys) => dalys.filter(Boolean).join(", ");

/**
 * Adapterio 404, kai istorinės redakcijos tokenas pasenęs: e-TAR nuoroda
 * peradresuoja į bendrą to paties akto redakcijų sąrašą, t. y. tos redakcijos
 * tuo adresu nebėra. (Anksčiau tai atrodė kaip 502 „upstream_shape_changed" ir
 * be reikalo suko backoff'ą.) Kartoti tą pačią užklausą beprasmiška — tokenas
 * neatgis; reikia šviežio tokeno iš `/editions`.
 */
const PASENĘS_TOKENAS = "historical_consolidated_edition_unavailable";

const yraPasenęsTokenas = (error) =>
    error instanceof ETarNotFoundError && error.body?.error === PASENĘS_TOKENAS;

export function createRunner({ api, sidecar, concurrency, force = false }) {
    /** Atsakymas → sidecar → Postgres. Grąžina md5. */
    function store(payload) {
        return saveResponse(sidecar, payload);
    }

    // Pasenęs vienos redakcijos tokenas paprastai reiškia, kad e-TAR perleido
    // viso akto tokenus, tad sąrašą persikraunam vieną kartą aktui: kiti to
    // paties akto darbai jau ras šviežias eilutes (arba nieko, jei jų redakcija
    // dingo kartu su senuoju tokenu).
    const sąrašaiAtnaujinti = new Set();

    const runner = {
        /** 1 etapas: viena diena, visi jos puslapiai. */
        async scrapeDay(day) {
            const started = Date.now();
            let page = 1;
            let totalPages = 1;
            let discovered = 0;
            let seen = 0;

            while (page <= totalPages) {
                const response = await api.searchLegalActs({ from: day, to: day, page });
                totalPages = response.pagination?.total_pages ?? 1;
                seen += response.items?.length ?? 0;
                discovered += await upsertDiscoveredActs(response.items ?? []);
                page++;
            }

            await markDayScraped(day);
            log(
                `diena ${day} ${String(Date.now() - started).padStart(5)}ms`
                + ` (${totalPages} psl., ${seen} eil., ${discovered} nauji aktai)`,
            );
            return { seen, discovered };
        },

        /** 2 etapas: originalus dokumentas. */
        async scrapeDocument(legalActId) {
            const started = Date.now();
            const payload = await api.getLegalAct(legalActId);
            const fetched = Date.now();
            const { keitimas } = await saveDocument(payload, {
                md5: store(payload), mark: { stage: "document" }, force,
            });
            logRequest({
                etapas: "dok ", id: legalActId, keitimas,
                fetchMs: fetched - started, dbMs: Date.now() - fetched,
                detalė: detalės(simboliai(payload), užklausos(payload)), pavadinimas: payload.title,
            });
        },

        /** 3 etapas: redakcijų sąrašas. */
        async scrapeEditionList(legalActId) {
            const started = Date.now();
            const payload = await api.getEditionList(legalActId);
            const fetched = Date.now();
            const { keitimas } = await saveEditionList(payload, {
                md5: store(payload), mark: { stage: "editions" }, force,
            });
            logRequest({
                etapas: "red ", id: legalActId, keitimas,
                fetchMs: fetched - started, dbMs: Date.now() - fetched,
                detalė: detalės(`${payload.editions?.length ?? 0} red.`, užklausos(payload)), pavadinimas: payload.title,
            });
        },

        /** 4 etapas: galiojanti suvestinė. 404 = e-TAR sako, kad jos nėra. */
        async scrapeConsolidated(legalActId) {
            const started = Date.now();
            let payload;
            try {
                payload = await api.getConsolidatedEdition(legalActId);
            } catch (error) {
                if (error instanceof ETarNotFoundError) {
                    const fetched = Date.now();
                    await markStageDone(legalActId, "asr");
                    // Ne klaida, o šaltinio atsakymas „suvestinės nėra" — tad
                    // logo eilutė tokia pat, tik su „nėra" vietoj `keitimas`.
                    logRequest({
                        etapas: "suv ", id: legalActId, keitimas: "nėra",
                        fetchMs: fetched - started, dbMs: Date.now() - fetched,
                    });
                    return;
                }
                throw error;
            }
            const fetched = Date.now();
            const { keitimas } = await saveDocument(payload, {
                md5: store(payload), mark: { stage: "asr" }, force,
            });
            logRequest({
                etapas: "suv ", id: legalActId, keitimas,
                fetchMs: fetched - started, dbMs: Date.now() - fetched,
                detalė: detalės(simboliai(payload), užklausos(payload)), pavadinimas: payload.title,
            });
        },

        /** 5 etapas: konkreti istorinė suvestinė. 404 = tokenas pasenęs. */
        async scrapeHistoricalEdition({ legalActId, editionToken }) {
            const started = Date.now();
            let payload;
            try {
                payload = await api.getHistoricalConsolidatedEdition(legalActId, editionToken);
            } catch (error) {
                if (!yraPasenęsTokenas(error)) throw error;

                if (!sąrašaiAtnaujinti.has(legalActId)) {
                    sąrašaiAtnaujinti.add(legalActId);
                    await runner.scrapeEditionList(legalActId);
                }
                // Sąrašas pasikeitė → eilutė su senuoju tokenu jau ištrinta ir
                // šis darbas nebeturi objekto. Jei tokenas išliko, adapteris ir
                // sąrašas nesutaria — tada tai tikra klaida su įprastu backoff'u.
                if (await editionExists(legalActId, editionToken)) throw error;

                const fetched = Date.now();
                logRequest({
                    etapas: "ist ", id: `${legalActId}/${editionToken}`, keitimas: "pasenęs",
                    fetchMs: fetched - started, dbMs: Date.now() - fetched,
                });
                return;
            }
            const fetched = Date.now();
            const { keitimas } = await saveDocument(payload, {
                md5: store(payload), mark: { editionToken }, force,
            });
            logRequest({
                etapas: "ist ", id: `${legalActId}/${editionToken}`, keitimas,
                fetchMs: fetched - started, dbMs: Date.now() - fetched,
                detalė: detalės(simboliai(payload), užklausos(payload)), pavadinimas: payload.title,
            });
        },

        concurrency,
    };

    return runner;
}

export const STAGES = ["days", "documents", "editions", "asr", "historical"];

/**
 * Etapo aprašas: iš kur imti darbą, ką su juo daryti ir kaip vadinti elementą.
 * `key` reikalingas pipeline režimui — pagal jį atmetami elementai, kurie jau
 * yra darbe (DB žyma uždedama tik po sėkmės, tad `pick` juos vis dar grąžintų).
 */
function stageSpecs(runner, { rescrapeDays }) {
    return {
        days: {
            label: "dienos",
            batchSize: 50,
            key: day => day,
            // "eTarScrapeDay" klaidų skaitiklio neturi, tad nepavykusi diena
            // lieka nepažymėta — pakartotinį ėmimą stabdo planuoklio `skipped`.
            pick: take => pickDaysToScrape({ limit: take, rescrapeOlderThanDays: rescrapeDays }),
            work: day => runner.scrapeDay(day),
            onError: (day, error) => log(`Diena ${day} nepavyko: ${error.message}`),
        },
        documents: {
            label: "dokumentai",
            key: id => id,
            pick: take => pickActsToScrape("document", { limit: take }),
            work: id => runner.scrapeDocument(id),
            onError: (id, error) => recordFailure(id, error),
        },
        editions: {
            label: "redakcijų sąrašai",
            key: id => id,
            pick: take => pickActsToScrape("editions", { limit: take }),
            work: id => runner.scrapeEditionList(id),
            onError: (id, error) => recordFailure(id, error),
        },
        asr: {
            label: "galiojančios suvestinės",
            key: id => id,
            pick: take => pickActsToScrape("asr", { limit: take }),
            work: id => runner.scrapeConsolidated(id),
            onError: (id, error) => recordFailure(id, error),
        },
        historical: {
            label: "istorinės suvestinės",
            key: edition => `${edition.legalActId}/${edition.editionToken}`,
            pick: take => pickEditionsToScrape({ limit: take }),
            work: edition => runner.scrapeHistoricalEdition(edition),
            onError: (edition, error) => recordEditionFailure(edition.legalActId, edition.editionToken, error),
        },
    };
}

const POLL_MS = 250;
const PIPELINE_LOG_EVERY = 50;

/**
 * Vienas planuoklis visiems etapams: `concurrency` darbininkų, kurie NUOLAT
 * turi darbo. Darbininkas, baigęs vieną elementą, iš karto ima kitą iš buferio —
 * nėra jokio „porcijos" barjero, tad iš 40 baigus vienam iškart siunčiamas 41-as
 * ir vienu metu vėl sukasi 40.
 *
 * Anksčiau čia buvo porcijų ciklas (`pick` 200 → apdirbam visus 200 → `pick`
 * kitus): porcijos gale likę keli lėti elementai suko po vieną, o visi kiti
 * darbininkai stovėjo, ir taip po kiekvieno 200-uko. Dabar buferis pildomas
 * PRIEŠ jam ištuštėjant (žr. `maybePrefetch`), tad DB užklausa persidengia su
 * darbu ir baseinas nesutrūkinėja.
 *
 * Paleidus vieną etapą (`--stage documents`) veikia lygiai tas pats planuoklis —
 * tiesiog su viena eile.
 *
 * Pabaiga: visi buferiai tušti, `pick` nieko negrąžina IR niekas nedirba — tik
 * tada naujo darbo nebegali atsirasti (dirbantis darbininkas dar gali atrasti
 * naujų aktų per susijusių aktų nuorodas).
 */
export async function runPipeline(specs, { concurrency, limit = Infinity }) {
    const state = Object.entries(specs).map(([name, spec]) => ({
        ...spec, name, buffer: [], inFlight: new Set(), skipped: new Set(),
        done: 0, failed: 0, logged: 0,
    }));

    let busy = 0;
    let cursor = 0;
    let refilling = null;

    // Naujas darbas atsiranda tik kai kuris nors darbininkas baigia savo darbą
    // (diena atranda aktų, redakcijų sąrašas — redakcijų). Todėl vietoj aklo
    // miego laukiam signalo: kitaip darbininkai prasnaustų iki `POLL_MS` galo,
    // nors darbo atsirado iš karto. `POLL_MS` lieka tik kaip saugiklis.
    let waiters = [];
    const wakeAll = () => { for (const resolve of waiters.splice(0)) resolve(); };
    const waitForWork = () => Promise.race([
        new Promise(resolve => waiters.push(resolve)),
        sleep(POLL_MS),
    ]);

    async function refillAll() {
        await Promise.all(state.map(async (s) => {
            // Buferio elementai jau yra `inFlight` — antrą kartą jų neskaičiuojam.
            const taken = s.done + s.failed + s.inFlight.size;
            const take = Math.min(s.batchSize ?? 200, limit - taken);
            if (take <= 0) return;
            const items = await s.pick(take);
            for (const item of items) {
                // Elementas, kuris jau yra darbe arba buferyje: DB žymos dar nėra,
                // tad `pick` jį grąžina pakartotinai. Be šito du darbininkai imtų
                // tą patį aktą.
                const key = s.key(item);
                // `skipped` — šiame paleidime jau nulūžę elementai. DB backoff'as
                // (`retryAfter`) uždedamas tik po klaidos, tad tarp lūžimo ir
                // `recordFailure` pabaigos `pick` tą patį elementą dar spėja
                // grąžinti; dienos savo skaitiklio iš viso neturi.
                if (s.inFlight.has(key) || s.skipped.has(key)) continue;
                s.inFlight.add(key);
                s.buffer.push(item);
            }
        }));
    }

    /**
     * Papildo buferius NELAUKIANT, kol jie ištuštės. Kviečiama paėmus darbą: jei
     * atsargų liko mažiau nei darbininkų, DB užklausa paleidžiama fone ir
     * baseinas tuo metu dirba toliau.
     */
    function maybePrefetch() {
        if (refilling) return;
        const stock = state.reduce((sum, s) => sum + s.buffer.length, 0);
        if (stock > concurrency) return;
        refilling = refillAll()
            .catch(() => {})            // laikina DB klaida — bandom kitą kartą
            .finally(() => { refilling = null; wakeAll(); });
    }

    async function nextJob() {
        for (;;) {
            for (let i = 0; i < state.length; i++) {
                const s = state[(cursor + i) % state.length];
                if (s.buffer.length) {
                    cursor = (cursor + i + 1) % state.length;
                    const item = s.buffer.shift();
                    maybePrefetch();     // atsargas pildom fone, darbo nestabdom
                    return { stage: s, item };
                }
            }

            // Buferiai tušti — čia jau laukiam papildymo.
            if (!refilling) {
                refilling = refillAll().finally(() => { refilling = null; });
            }
            await refilling;
            if (state.some(s => s.buffer.length)) continue;

            if (busy === 0) return null;
            await waitForWork();
        }
    }

    async function worker() {
        for (;;) {
            const job = await nextJob();
            if (!job) return;
            const { stage, item } = job;
            busy++;
            try {
                await stage.work(item);
                stage.done++;
            } catch (error) {
                stage.failed++;
                stage.skipped.add(stage.key(item));
                await stage.onError(item, error);
            } finally {
                busy--;
                stage.inFlight.delete(stage.key(item));
                wakeAll();
            }
            if (stage.done + stage.failed - stage.logged >= PIPELINE_LOG_EVERY) {
                stage.logged = stage.done + stage.failed;
                log(`${stage.label}: atlikta ${stage.done}, klaidų ${stage.failed}`);
            }
        }
    }

    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));

    return Object.fromEntries(state.map(s => [s.name, { done: s.done, failed: s.failed }]));
}

function runSingleStage(stage, runner, { concurrency, limit, rescrapeDays }) {
    const spec = stageSpecs(runner, { rescrapeDays })[stage];
    if (!spec) throw new Error(`Nežinomas etapas: ${stage}`);
    return runPipeline({ [stage]: spec }, { concurrency, limit });
}

/**
 * Paleidžia vieną etapą arba (`"all"`) visus lygiagrečiai viename baseine.
 * @param {Object} options
 * @param {"days"|"documents"|"editions"|"asr"|"historical"|"all"} stage
 */
export async function runStage(stage, options = {}) {
    const {
        concurrency = DEFAULT_CONCURRENCY,
        limit = Infinity,
        rescrapeDays = null,
        force = false,
        // Darbininkų tiek, kiek prašyta, bet ore — ne daugiau, nei adapteris
        // pajėgia: viską virš savo eilės jis atmeta su 503, o ne pastato į eilę.
        api = createETarApi({ maxInflight: Math.min(concurrency, 6) }),
        sidecar = openETarSidecar(),
        closeSidecar = true,
    } = options;

    const runner = createRunner({ api, sidecar, concurrency, force });

    try {
        // Dienų lentelė užsėta vieną kartą, tad be šito po pirmo pilno
        // pravažiavimo etapas amžinai rastų 0 darbo — vakar ir šiandien lentelėje
        // tiesiog neegzistuoja. Atgal neplečiam: tam yra `--discover`.
        if (stage === "days" || stage === "all") {
            const added = await ensureScrapeDaysForward();
            if (added > 0) log(`Pridėta naujų dienų: ${added}`);
        }

        if (stage === "all") {
            return await runPipeline(stageSpecs(runner, { rescrapeDays }), { concurrency, limit });
        }
        return { [stage]: await runSingleStage(stage, runner, { concurrency, limit, rescrapeDays }) };
    } finally {
        if (closeSidecar) closeSqlite(sidecar);
    }
}

function previousDay(date) {
    const value = new Date(`${date}T00:00:00Z`);
    value.setUTCDate(value.getUTCDate() - 1);
    return value.toISOString().slice(0, 10);
}

/**
 * Atradimas gilyn: viena užklausų grandinė su slenkančia viršutine data riba.
 *
 * Paieška „viskas iki `frontier`" grąžina naujausius pirma. Puslapiuojam ją, o
 * kai tarp rezultatų pasirodo SENESNĖ diena, ji tampa nauja riba ir puslapiavimas
 * prasideda iš naujo nuo pirmo puslapio. Todėl niekada nenuklystam giliai į
 * puslapius (kur e-TAR ir taip neatiduotų), tuščios kalendorinės dienos
 * praleidžiamos be nė vienos užklausos, o į "eTarScrapeDay" patenka tik tos
 * dienos, kuriose aktų realiai buvo.
 *
 * Sustoja tik tada, kai užklausa nebegrąžina nieko — jokios metų ribos nėra.
 *
 * @param {Object} opts
 * @param {string} [opts.from] - nuo kurios datos pradėti (numatyta: seniausia turima − 1 d.)
 * @param {string|null} [opts.floor] - neprivaloma apatinė riba
 * @param {number} [opts.maxDays] - kiek dienų daugiausia (pasižvalgymui)
 */
export async function discoverBackward({
    from = null, floor = null, maxDays = Infinity, api = createETarApi(),
} = {}) {
    let frontier = from ?? previousDay(await getOldestScrapeDay() ?? new Date().toISOString().slice(0, 10));
    let page = 1;
    let days = 0;
    let seen = 0;
    let discovered = 0;

    for (;;) {
        if (days >= maxDays) break;
        if (floor && frontier < floor) {
            log(`Pasiekta riba ${floor} — stabdoma`);
            break;
        }

        const started = Date.now();
        const response = await api.searchLegalActs({ to: frontier, page });
        const items = response.items ?? [];
        if (!items.length) {
            log(`Giliau nei ${frontier} aktų nebėra — pabaiga`);
            break;
        }

        const naujausia = items.find(item => item.adopted_at)?.adopted_at;
        if (naujausia && naujausia > frontier) {
            // Be šito, e-TAR ignoravus datos ribą, suktumės amžinai ties naujausiais.
            throw new Error(`e-TAR ignoravo datos ribą: gauta ${naujausia}, riba ${frontier}`);
        }

        seen += items.length;
        discovered += await upsertDiscoveredActs(items);

        // Ar šiame puslapyje jau matyti senesnė diena?
        const kita = items.map(item => item.adopted_at).find(date => date && date < frontier);
        const totalPages = response.pagination?.total_pages ?? 1;
        const baigta = Boolean(kita) || page >= totalPages;

        log(
            `${frontier} psl. ${page}/${totalPages} ${String(Date.now() - started).padStart(5)}ms`
            + ` (${items.length} eil., ${discovered} nauji iš viso)`
            + (kita ? ` → kita diena ${kita}` : ""),
        );

        if (!baigta) {
            page++;
            continue;
        }

        // Diena baigta. Žymim tik jei ji tikrai turėjo aktų — `--from` galėjo
        // nurodyti tuščią datą, ir tokios lentelėje nereikia.
        if (items.some(item => item.adopted_at === frontier)) {
            await markDayScraped(frontier);
            days++;
        }
        frontier = kita ?? previousDay(frontier);
        page = 1;
    }

    log(`Atradimas baigtas: ${days} dienų, ${seen} eilučių, ${discovered} nauji aktai`);
    return { days, seen, discovered, frontier };
}

/** Konkreti diena – patogu užpildyti spragą arba persiskaityti iš naujo. */
export async function scrapeSingleDay(day, { api = createETarApi(), sidecar = openETarSidecar() } = {}) {
    const runner = createRunner({ api, sidecar, concurrency: 1 });
    try {
        return await runner.scrapeDay(day);
    } finally {
        closeSqlite(sidecar);
    }
}

/** Vienkartinis vieno akto scrape'as – patogu rankiniam patikrinimui. */
export async function scrapeAct(legalActId, { api = createETarApi(), sidecar = openETarSidecar(), force = false } = {}) {
    const runner = createRunner({ api, sidecar, concurrency: 1, force });
    try {
        await runner.scrapeDocument(legalActId);
        await runner.scrapeEditionList(legalActId);
        await runner.scrapeConsolidated(legalActId);
        for (const edition of await pickEditionsToScrape({ limit: 10_000, legalActId, ignoreBackoff: true })) {
            await runner.scrapeHistoricalEdition(edition);
        }
    } finally {
        closeSqlite(sidecar);
    }
}

// ---------------------------------------------------------------
// CLI
// ---------------------------------------------------------------

const nr = (n) => Number(n).toLocaleString("lt-LT");

/** „████████░░ 78.3%" — progresas dalimi nuo viso. */
function progressBar(done, total, width = 22) {
    const ratio = total > 0 ? Math.min(1, done / total) : 0;
    const filled = Math.round(ratio * width);
    const pct = (ratio * 100).toFixed(1).padStart(5);
    return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${pct}%`;
}

/**
 * `--status` žmogui: kiekvienas etapas su savo progresu, po to bendri skaičiai.
 * Etapų vardai ir eiliškumas — tokie patys kaip `--stage`, kad iš lentelės
 * iškart matytųsi, ką paleisti toliau. Žalias JSON lieka po `--json`.
 */
function formatStatus(status, sidecar) {
    const aktai = status.aktaiViso;
    const eilutės = [
        ["1 dienos     ", status.dienosAtliktos, status.dienosViso],
        ["2 documents  ", status.dokumentaiAtlikti, aktai],
        ["3 editions   ", status.redakcijuSarasaiAtlikti, aktai],
        ["4 asr        ", status.suvestinesAtliktos, aktai],
        ["5 historical ", status.redakcijosAtliktos, status.redakcijosViso],
    ];

    const w = Math.max(...eilutės.map(([, done, total]) => `${nr(done)} / ${nr(total)}`.length));
    const out = ["", "  e-TAR scraper", ""];
    for (const [label, done, total] of eilutės) {
        const skaičiai = `${nr(done)} / ${nr(total)}`.padStart(w);
        const liko = total - done;
        out.push(`  ${label} ${skaičiai}  ${progressBar(done, total)}${liko > 0 ? `  liko ${nr(liko)}` : "  ✓"}`);
    }

    out.push("");
    out.push(`  Aktų iš viso        ${nr(aktai)}`);
    if (status.suKlaidomis > 0) out.push(`  Su klaidomis        ${nr(status.suKlaidomis)}`);
    if (status.saltinioBrokas > 0) {
        out.push(`  Šaltinio brokas     ${nr(status.saltinioBrokas)}  (SELECT * FROM "eTarSourceAnomaly")`);
    }
    if (sidecar) {
        const ratio = sidecar.rawBytes > 0 ? (sidecar.rawBytes / sidecar.zstdBytes).toFixed(1) : "0";
        out.push(
            `  Sidecar             ${nr(sidecar.count)} atsakymų · `
            + `${fmtBytes(sidecar.zstdBytes)} (iš ${fmtBytes(sidecar.rawBytes)}, ${ratio}×)`,
        );
    }
    out.push("");
    return out.join("\n");
}

const USAGE = `
e-TAR scraper (sidecar: /flashas/viespirkiai/eTar)

  node modules/eTar/eTarScrape.js --stage days [--limit N] [--rescrape-days N]
  node modules/eTar/eTarScrape.js --stage documents|editions|asr|historical [--limit N]
  node modules/eTar/eTarScrape.js --stage all
  node modules/eTar/eTarScrape.js --day 2024-03-15
  node modules/eTar/eTarScrape.js --discover
  node modules/eTar/eTarScrape.js --act <legalActId>
  node modules/eTar/eTarScrape.js --status [--json]

  --concurrency N   lygiagrečių užklausų (numatyta ${DEFAULT_CONCURRENCY})
  --force           perrašyti net jei md5 nepasikeitė (po normalizacijos pakeitimų)
  --rescrape-days N iš naujo praeiti dienas, skaitytas seniau nei prieš N d.
                    (aktai registruojami vėliau nei priimami, tad kartą nušluota
                    diena laikui bėgant „prisipildo" naujų)
  --discover        leistis gilyn dieną po dienos, kol randa aktų — jokios metų
                    ribos nėra. Viena užklausa suranda artimiausią dieną su
                    aktais, ji nuskaitoma, ir einam žemiau. Tuščios dienos
                    praleidžiamos be užklausų ir į lentelę nepatenka.
    --from DATA     nuo kurios datos pradėti (numatyta: seniausia turima − 1 d.)
    --floor DATA    neprivaloma apatinė riba; be jos eina iki duomenų pabaigos
    --limit N       apriboti dienų skaičių (tik pasižvalgymui)

Konfigūracija (config.js arba .env): ETAR_API_URL, ETAR_API_KEY, ETAR_SIDECAR_DIR

Prieš pirmą paleidimą: psql -f modules/eTar/schema.sql
`;

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || (!args.stage && !args.act && !args.day && !args.status && !args.discover)) {
        console.log(USAGE.trim());
        process.exit(args.help ? 0 : 1);
    }

    if (args.status) {
        const status = await getScrapeStatus();
        if (args.json) {
            console.log(JSON.stringify(status, null, 2));
        } else {
            // Sidecar'o gali ir nebūti (kitas mazgas, dar nepaleista) — tada
            // tiesiog praleidžiam tą eilutę, o ne griūvam dėl statistikos.
            let sidecarStats = null;
            try {
                const db = openETarSidecar({ readonly: true });
                sidecarStats = getETarSidecarStats(db);
                closeSqlite(db);
            } catch { /* nėra sidecar'o — ne bėda */ }
            console.log(formatStatus(status, sidecarStats));
        }
    } else if (args.discover) {
        // `--discover` yra savarankiškas režimas, ne etapas. Anksčiau kartu
        // paduotas `--stage` būdavo tyliai ignoruojamas — pasakom aiškiai.
        if (args.stage) log(`--stage ${args.stage} ignoruojamas: --discover yra atskiras režimas`);
        console.log(JSON.stringify(await discoverBackward({
            from: typeof args.from === "string" ? args.from : null,
            floor: typeof args.floor === "string" ? args.floor : null,
            maxDays: numArg(args.limit, Infinity),
        }), null, 2));
    } else if (args.day) {
        console.log(JSON.stringify(await scrapeSingleDay(String(args.day)), null, 2));
    } else if (args.act) {
        await scrapeAct(String(args.act), { force: Boolean(args.force) });
        log(`Aktas ${args.act} nuskaitytas`);
    } else {
        const results = await runStage(String(args.stage), {
            concurrency: numArg(args.concurrency, DEFAULT_CONCURRENCY),
            limit: numArg(args.limit, Infinity),
            rescrapeDays: args["rescrape-days"] ? numArg(args["rescrape-days"], null) : null,
            force: Boolean(args.force),
        });
        console.log(JSON.stringify(results, null, 2));
    }
    process.exit(0);
}
