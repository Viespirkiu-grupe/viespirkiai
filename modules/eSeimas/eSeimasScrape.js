import { log } from "../../utils/log.js";
import { sleep } from "../../utils/time.js";
import { parseArgs, numArg } from "../../utils/cliArgs.js";
import { createESeimasApi, ESeimasNotFoundError } from "./eSeimasApi.js";
import { closeSqlite, getESeimasSidecarStats, openESeimasSidecar, saveResponse } from "./eSeimasSidecar.js";
import { fmtBytes } from "../../utils/units.js";
import {
    editionExists,
    ensureScrapeDaysForward,
    formatDiscovery,
    getActDiscoveries,
    getOldestScrapeDay,
    getScrapeStatus,
    markDayScraped,
    markStageDone,
    pickActsToScrape,
    pickDaysToScrape,
    pickEditionsToScrape,
    recordDocumentOutcome,
    recordEditionFailure,
    recordFailure,
    saveDocument,
    saveEditionList,
    upsertDiscoveredActs,
} from "./eSeimasStore.js";
import {
    assertDayPromiseTable,
    getDayPromiseStatus,
    pickDaysWithoutPromise,
    recordDayPromise,
} from "./store/dayPromise.js";

// e-Seimas scraper'is virš stateless e-Seimas API adapterio.
//
// Penki etapai, kiekvienas su savo žyma DB (žr. "eSeimasScrapeDay",
// "eSeimasLegalActScrape", "eSeimasEdition"."scrapedAt"), tad bet kurį galima nutraukti
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
// (`<SIDECAR_DIR>/eSeimas.sqlite`), o Postgres'e lieka normalizuota dalis + md5.
// Dienos paieška į sidecar'ą nerašoma — ji tik atranda ID.
//
// Tas pats branduolys naudojamas dviem režimais: CLI `runPipeline` skirtas
// rankiniam backfill'ui, o eSeimasTaskJobs kviečia atskirus scrape metodus po vieną
// iš lygiagrečių TaskRunner eilių. TaskRunner vidinio pipeline'o nepaleidžia.

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
 * Kiek užklausų į e-Seimas adapteris sudėjo už mūsų vienos. Iš `http_requests` (į
 * sidecar'ą jis nekeliauja, tad matomas tik čia) — iš karto matyti, ar 11 s
 * atsakymas yra vienas lėtas šuolis, ar tuzinas puslapių po sekundę.
 */
const užklausos = (payload) => {
    const n = payload?.http_requests?.length;
    return n ? `${n} užkl.` : null;
};

const detalės = (...dalys) => dalys.filter(Boolean).join(", ");

/**
 * Adapterio 404, kai istorinės redakcijos tokenas pasenęs: e-Seimas nuoroda
 * peradresuoja į bendrą to paties akto redakcijų sąrašą, t. y. tos redakcijos
 * tuo adresu nebėra. (Anksčiau tai atrodė kaip 502 „upstream_shape_changed" ir
 * be reikalo suko backoff'ą.) Kartoti tą pačią užklausą beprasmiška — tokenas
 * neatgis; reikia šviežio tokeno iš `/editions`.
 */
const PASENĘS_TOKENAS = "historical_consolidated_edition_unavailable";

const yraPasenęsTokenas = (error) =>
    error instanceof ESeimasNotFoundError && error.body?.error === PASENĘS_TOKENAS;

export function createRunner({ api, sidecar, concurrency, force = false, trace = false }) {
    /** Atsakymas → sidecar → Postgres. Grąžina md5. */
    function store(payload) {
        return saveResponse(sidecar, payload);
    }

    // Pasenęs vienos redakcijos tokenas paprastai reiškia, kad e-Seimas perleido
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
                discovered += await upsertDiscoveredActs(response.items ?? [], trace && {
                    source: "day", searchFrom: day, searchTo: day, page, pagination: response.pagination,
                });
                page++;
            }

            await markDayScraped(day);
            log(
                `diena ${day} ${String(Date.now() - started).padStart(5)}ms`
                + ` (${totalPages} psl., ${seen} eil., ${discovered} nauji aktai)`,
            );
            return { seen, discovered };
        },

        /**
         * 2 etapas: originalus dokumentas.
         *
         * Su `--trace` prie kiekvienos eilutės prikabinamas AKTO ATRADIMAS (iš
         * kurios dienos paieškos, kurio puslapio ir kelintos eilutės jis atėjo,
         * kiek rezultatų ta paieška žadėjo) ir rezultatas surašomas atgal į
         * "eSeimasActDiscovery" — tam, kad matytųsi, iš kur imasi 404 aktai.
         */
        async scrapeDocument(category, legalActId, { attempt = 1 } = {}) {
            const started = Date.now();
            const atradimai = trace ? await getActDiscoveries(category, legalActId, { limit: 1 }) : [];
            const payload = await api.getLegalAct(category, legalActId);
            const fetched = Date.now();
            const { keitimas } = await saveDocument(payload, {
                category, md5: store(payload), mark: { stage: "document" }, force,
            });
            if (trace) await recordDocumentOutcome(category, legalActId, "ok", { attempts: attempt });
            logRequest({
                etapas: "dok ", id: `${category}/${legalActId}`, keitimas,
                fetchMs: fetched - started, dbMs: Date.now() - fetched,
                detalė: detalės(
                    simboliai(payload), užklausos(payload),
                    trace ? formatDiscovery(atradimai[0]) : null,
                    attempt > 1 ? `${attempt} bandymas` : null,
                ),
                pavadinimas: payload.title,
            });
        },

        /** 3 etapas: redakcijų sąrašas. */
        async scrapeEditionList(category, legalActId) {
            const started = Date.now();
            const payload = await api.getEditionList(category, legalActId);
            const fetched = Date.now();
            const { keitimas } = await saveEditionList(payload, {
                category, md5: store(payload), mark: { stage: "editions" }, force,
            });
            logRequest({
                etapas: "red ", id: `${category}/${legalActId}`, keitimas,
                fetchMs: fetched - started, dbMs: Date.now() - fetched,
                detalė: detalės(`${payload.editions?.length ?? 0} red.`, užklausos(payload)), pavadinimas: payload.title,
            });
        },

        /** 4 etapas: galiojanti suvestinė. 404 = e-Seimas sako, kad jos nėra. */
        async scrapeConsolidated(category, legalActId) {
            const started = Date.now();
            let payload;
            try {
                payload = await api.getConsolidatedEdition(category, legalActId);
            } catch (error) {
                if (error instanceof ESeimasNotFoundError) {
                    const fetched = Date.now();
                    await markStageDone(category, legalActId, "asr");
                    // Ne klaida, o šaltinio atsakymas „suvestinės nėra" — tad
                    // logo eilutė tokia pat, tik su „nėra" vietoj `keitimas`.
                    logRequest({
                        etapas: "suv ", id: `${category}/${legalActId}`, keitimas: "nėra",
                        fetchMs: fetched - started, dbMs: Date.now() - fetched,
                    });
                    return;
                }
                throw error;
            }
            const fetched = Date.now();
            const { keitimas } = await saveDocument(payload, {
                category, md5: store(payload), mark: { stage: "asr" }, force,
            });
            logRequest({
                etapas: "suv ", id: `${category}/${legalActId}`, keitimas,
                fetchMs: fetched - started, dbMs: Date.now() - fetched,
                detalė: detalės(simboliai(payload), užklausos(payload)), pavadinimas: payload.title,
            });
        },

        /** 5 etapas: konkreti istorinė suvestinė. 404 = tokenas pasenęs. */
        async scrapeHistoricalEdition({ category, legalActId, editionToken }) {
            const started = Date.now();
            let payload;
            try {
                payload = await api.getHistoricalConsolidatedEdition(category, legalActId, editionToken);
            } catch (error) {
                if (!yraPasenęsTokenas(error)) throw error;

                const actKey = `${category}\0${legalActId}`;
                if (!sąrašaiAtnaujinti.has(actKey)) {
                    sąrašaiAtnaujinti.add(actKey);
                    await runner.scrapeEditionList(category, legalActId);
                }
                // Sąrašas pasikeitė → eilutė su senuoju tokenu jau ištrinta ir
                // šis darbas nebeturi objekto. Jei tokenas išliko, adapteris ir
                // sąrašas nesutaria — tada tai tikra klaida su įprastu backoff'u.
                if (await editionExists(category, legalActId, editionToken)) throw error;

                const fetched = Date.now();
                logRequest({
                    etapas: "ist ", id: `${category}/${legalActId}/${editionToken}`, keitimas: "pasenęs",
                    fetchMs: fetched - started, dbMs: Date.now() - fetched,
                });
                return;
            }
            const fetched = Date.now();
            const { keitimas } = await saveDocument(payload, {
                category, md5: store(payload), mark: { editionToken }, force,
            });
            logRequest({
                etapas: "ist ", id: `${category}/${legalActId}/${editionToken}`, keitimas,
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
 *
 * `pick(take, praleisti)`: `praleisti` — šiame paleidime jau nepavykę elementai.
 * Jie perduodami PAČIAI užklausai, o ne filtruojami po jos: kitaip jie stovėtų
 * rikiuotės priekyje, užimtų visą `LIMIT` langą ir planuoklis gautų tuščią
 * porciją, nors darbo dar apstu (žr. runPipeline pabaigos sąlygą).
 */
function stageSpecs(runner, { rescrapeDays, trace = false }) {
    return {
        days: {
            label: "dienos",
            batchSize: 50,
            key: day => day,
            // "eSeimasScrapeDay" klaidų skaitiklio neturi, tad nepavykusi diena
            // lieka nepažymėta — pakartotinį ėmimą stabdo `exclude`.
            pick: (take, praleisti) =>
                pickDaysToScrape({ limit: take, rescrapeOlderThanDays: rescrapeDays, exclude: praleisti }),
            work: day => runner.scrapeDay(day),
            onError: (day, error, bandymai) => log(`Diena ${day} nepavyko po ${bandymai} bandymų: ${error.message}`),
        },
        documents: {
            label: "dokumentai",
            key: act => `${act.category}\0${act.legalActId}`,
            pick: (take, praleisti) => pickActsToScrape("document", { limit: take, exclude: praleisti }),
            work: (act, attempt) => runner.scrapeDocument(act.category, act.legalActId, { attempt }),
            onError: async (act, error, bandymai) => {
                // Su `--trace` prie klaidos parodom, iš kurios paieškos aktas
                // apskritai atsirado — 404 kaltininko ieškom ten, ne čia.
                const atradimas = trace
                    ? ` [${formatDiscovery((await getActDiscoveries(act.category, act.legalActId, { limit: 1 }))[0])}]`
                    : "";
                log(`dokumentas ${act.category}/${act.legalActId} nepavyko po ${bandymai} bandymų${atradimas}: ${error.message}`);
                if (trace) {
                    await recordDocumentOutcome(act.category, act.legalActId,
                        error instanceof ESeimasNotFoundError ? "notFound" : "error",
                        { attempts: bandymai, error });
                }
                await recordFailure(act.category, act.legalActId, error);
            },
        },
        editions: {
            label: "redakcijų sąrašai",
            key: act => `${act.category}\0${act.legalActId}`,
            pick: (take, praleisti) => pickActsToScrape("editions", { limit: take, exclude: praleisti }),
            work: act => runner.scrapeEditionList(act.category, act.legalActId),
            onError: async (act, error, bandymai) => {
                log(`redakcijų sąrašas ${act.category}/${act.legalActId} nepavyko po ${bandymai} bandymų: ${error.message}`);
                await recordFailure(act.category, act.legalActId, error);
            },
        },
        asr: {
            label: "galiojančios suvestinės",
            key: act => `${act.category}\0${act.legalActId}`,
            pick: (take, praleisti) => pickActsToScrape("asr", { limit: take, exclude: praleisti }),
            work: act => runner.scrapeConsolidated(act.category, act.legalActId),
            onError: async (act, error, bandymai) => {
                log(`suvestinė ${act.category}/${act.legalActId} nepavyko po ${bandymai} bandymų: ${error.message}`);
                await recordFailure(act.category, act.legalActId, error);
            },
        },
        historical: {
            label: "istorinės suvestinės",
            key: edition => `${edition.category}\0${edition.legalActId}\0${edition.editionToken}`,
            pick: (take, praleisti) => pickEditionsToScrape({ limit: take, exclude: praleisti }),
            work: edition => runner.scrapeHistoricalEdition(edition),
            onError: async (edition, error, bandymai) => {
                log(`istorinė redakcija ${edition.category}/${edition.legalActId}/${edition.editionToken} nepavyko po ${bandymai} bandymų: ${error.message}`);
                await recordEditionFailure(edition.category, edition.legalActId, edition.editionToken, error);
            },
        },
    };
}

const POLL_MS = 250;
const PIPELINE_LOG_EVERY = 50;
/**
 * Kiek kartų iš viso bandom vieną elementą, kol paskelbiam klaidą.
 *
 * Kartojam PLANUOKLIO lygyje, o ne API kliente (ten kartojimo sąmoningai nėra —
 * žr. modules/eSeimas/eSeimasApi.js): taip pauzė mažesnė nei DB backoff'o
 * pusvalandis, bet elementas nesikartoja iškart tuo pačiu ryšiu. Ilgesnį poilsį
 * po visų bandymų toliau skiria DB (`failureCount`/`retryAfter`).
 *
 * 404 čia irgi kartojamas: būtent tai ir tikrinam — ar akto tikrai nėra, ar
 * e-Seimas kartais atsako 404 į tą pačią užklausą.
 */
const DEFAULT_ATTEMPTS = 3;
/** Pauzės tarp bandymų (ms), po vieną kiekvienam pakartojimui. */
const RETRY_DELAYS_MS = [2_000, 5_000];
/** Pauzė prieš kartojant nepavykusią `pick` užklausą. */
const REFILL_RETRY_MS = 5_000;
/** Po tiek `pick` klaidų iš eilės pasiduodam — su klaida, o ne tyliai „baigta". */
const REFILL_MAX_ERRORS = 12;

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
 * Pabaiga: visi buferiai tušti, niekas nedirba IR `pick` nieko negrąžino
 * užklausoje, PRADĖTOJE niekam nedirbant. Paskutinė sąlyga svarbi: porcija,
 * paimta elementams tebeesant ore, grąžina juos pačius, planuoklis juos atmeta
 * kaip `inFlight` ir buferis lieka tuščias — tai atrodo lygiai kaip darbo
 * pabaiga, nors darbo dar pilna. Dėl to pravažiavimas ir nutrūkdavo viduryje
 * „lyg baigęs". Be to, dirbantis darbininkas dar gali atrasti naujo darbo
 * (diena — aktų, redakcijų sąrašas — redakcijų).
 */
export async function runPipeline(specs, { concurrency, limit = Infinity, attempts = DEFAULT_ATTEMPTS }) {
    const state = Object.entries(specs).map(([name, spec]) => ({
        ...spec, name, buffer: [], inFlight: new Set(), skipped: new Map(),
        done: 0, failed: 0, logged: 0,
    }));

    let busy = 0;
    let cursor = 0;
    let refilling = null;
    let refillErrors = 0;
    // Didėja kaskart, kai darbininkas baigia elementą. Papildymo rezultatas,
    // paimtas SU sena šio skaitiklio reikšme, apie darbo pabaigą nieko nesako:
    // tuo metu elementai dar buvo ore ir `pick` juos grąžino kaip užimtus.
    let darboVersija = 0;
    let refillVersija = 0;

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
            // Šiame paleidime nulūžę elementai atmetami PAČIOJE užklausoje: jų
            // DB backoff'as (`retryAfter`) kada nors baigiasi, o dienos jo iš
            // viso neturi, tad kitaip jie grįžtų į `LIMIT` langą ir porcija
            // ateitų tuščia — planuoklis tai palaikytų darbo pabaiga.
            // Perduodam VISUS šiame paleidime nepavykusius elementus. Čia negali
            // būti fiksuotos ribos: pirmi neperduoti elementai vėl užpildytų visą
            // SQL LIMIT langą, atmintyje būtų atmesti kaip `skipped`, o tuščias
            // buferis būtų klaidingai palaikytas darbo pabaiga.
            const items = await s.pick(take, [...s.skipped.values()]);
            for (const item of items) {
                // Elementas, kuris jau yra darbe arba buferyje: DB žymos dar nėra,
                // tad `pick` jį grąžina pakartotinai. Be šito du darbininkai imtų
                // tą patį aktą.
                const key = s.key(item);
                // `skipped` čia vis tiek tikrinam: tarp lūžimo ir `recordFailure`
                // pabaigos užklausa galėjo išeiti su dar senu sąrašu.
                if (s.inFlight.has(key) || s.skipped.has(key)) continue;
                s.inFlight.add(key);
                s.buffer.push(item);
            }
        }));
    }

    /**
     * Vienas bendras papildymas visiems darbininkams. Klaidos NEmeta: laikinas DB
     * trikdis neturi nei nužudyti darbininko, nei atrodyti kaip „darbo nebėra" —
     * grąžinam `false` ir kartojam. Nuolatinę bėdą pagauna `REFILL_MAX_ERRORS`.
     * @returns {Promise<boolean>} ar porcija paimta sėkmingai
     */
    function refillOnce() {
        if (!refilling) {
            refillVersija = darboVersija;
            refilling = refillAll().then(
                () => { refillErrors = 0; return true; },
                (error) => {
                    refillErrors += 1;
                    log(`Darbo porcijos paimti nepavyko (${refillErrors}/${REFILL_MAX_ERRORS}): ${error.message}`);
                    return false;
                },
            ).finally(() => { refilling = null; wakeAll(); });
        }
        return refilling;
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
        void refillOnce();
    }

    /**
     * Grąžina darbą arba `null`, kai jo tikrai nebėra.
     *
     * `busy` didinam ČIA, o ne darbininke: tarp `nextJob` grįžimo ir darbininko
     * `busy++` yra microtask'o tarpas, per kurį kitas darbininkas pamatytų
     * `busy === 0` su tuščiais buferiais ir išeitų kaip po darbo pabaigos. Taip
     * baseinas tirpdavo po vieną darbininką, o nelaimingu atveju — visas iškart,
     * ir procesas nutildavo „lyg baigęs" viduryje darbo.
     */
    async function nextJob() {
        for (;;) {
            for (let i = 0; i < state.length; i++) {
                const s = state[(cursor + i) % state.length];
                if (s.buffer.length) {
                    cursor = (cursor + i + 1) % state.length;
                    const item = s.buffer.shift();
                    busy++;              // atomiškai su elemento paėmimu
                    maybePrefetch();     // atsargas pildom fone, darbo nestabdom
                    return { stage: s, item };
                }
            }

            // Buferiai tušti — čia jau laukiam papildymo. Versiją pasižymim
            // PRIEŠ laukimą: po jo ji jau gali būti kito, naujesnio papildymo.
            const papildymas = refillOnce();
            const pradėtaVersijoje = refillVersija;
            const ok = await papildymas;
            if (state.some(s => s.buffer.length)) continue;

            if (!ok) {
                // Nežinom, ar darbo nebėra — žinom tik, kad nepavyko paklausti.
                if (refillErrors >= REFILL_MAX_ERRORS) {
                    throw new Error(`Darbo porcijos paimti nepavyko ${refillErrors} kartus iš eilės — stabdoma`);
                }
                await sleep(REFILL_RETRY_MS);
                continue;
            }

            // Tuščia porcija dar nereiškia pabaigos: dirbantis darbininkas gali
            // atrasti naujo darbo (diena — aktų, redakcijų sąrašas — redakcijų).
            if (busy === 0) {
                // Ši porcija paimta, kol elementai dar buvo ore: `pick` juos
                // grąžino, o mes atmetėm kaip `inFlight`, ir buferis liko tuščias
                // ne dėl darbo pabaigos. Klausiam DB iš naujo — švariai.
                if (pradėtaVersijoje !== darboVersija) continue;
                return null;
            }
            await waitForWork();
        }
    }

    /**
     * Vienas elementas su pakartojimais. Galutinė klaida praleidžiama toliau
     * su `bandymai` — kviečiančiam reikia žinoti, kelintas bandymas sudegė
     * (skaičius keliauja į DB, žr. "eSeimasActDiscovery"."documentAttempts").
     */
    async function suBandymais(stage, item) {
        for (let attempt = 1; ; attempt++) {
            try {
                return await stage.work(item, attempt);
            } catch (error) {
                if (attempt >= attempts) {
                    if (error instanceof Error) error.bandymai = attempt;
                    throw error;
                }
                const pauzė = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
                log(`${stage.label}: ${stage.key(item).replace(/\0/g, "/")} bandymas ${attempt}/${attempts}`
                    + ` nepavyko (${error.message}) — kartojam po ${Math.round(pauzė / 1000)} s`);
                await sleep(pauzė);
            }
        }
    }

    async function worker() {
        for (;;) {
            const job = await nextJob();
            if (!job) return;
            const { stage, item } = job;
            try {
                await suBandymais(stage, item);
                stage.done++;
            } catch (error) {
                stage.failed++;
                stage.skipped.set(stage.key(item), item);
                await stage.onError(item, error, error?.bandymai ?? attempts);
            } finally {
                busy--;
                darboVersija++;
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

    // Aiškiai pasakom, kodėl sustojom: anksčiau pravažiavimas galėjo nutrūkti
    // viduryje ir tai atrodė lygiai taip pat, kaip tvarkinga pabaiga.
    log(
        `Pabaiga: darbo eilėse nebeliko (${state.map(s => `${s.label} ${s.done}/${s.done + s.failed}`).join(", ")})`
        + (state.some(s => s.skipped.size)
            ? `; šiame paleidime praleista po klaidų: ${state.filter(s => s.skipped.size).map(s => `${s.label} ${s.skipped.size}`).join(", ")}`
            : ""),
    );

    return Object.fromEntries(state.map(s => [s.name, { done: s.done, failed: s.failed }]));
}

function runSingleStage(stage, runner, { concurrency, limit, rescrapeDays, trace, attempts }) {
    const spec = stageSpecs(runner, { rescrapeDays, trace })[stage];
    if (!spec) throw new Error(`Nežinomas etapas: ${stage}`);
    return runPipeline({ [stage]: spec }, { concurrency, limit, attempts });
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
        // Atradimų sekimas į "eSeimasActDiscovery" (`--trace`). Numatyta išjungta:
        // lentelės gali ir nebūti, o įprastam pravažiavimui ji nereikalinga.
        trace = false,
        attempts = DEFAULT_ATTEMPTS,
        // Darbininkų tiek, kiek prašyta, bet ore — ne daugiau, nei adapteris
        // pajėgia: viską virš savo eilės jis atmeta su 503, o ne pastato į eilę.
        api = createESeimasApi({ maxInflight: Math.min(concurrency, 6) }),
        sidecar = openESeimasSidecar(),
        closeSidecar = true,
    } = options;

    const runner = createRunner({ api, sidecar, concurrency, force, trace });

    try {
        // Dienų lentelė užsėta vieną kartą, tad be šito po pirmo pilno
        // pravažiavimo etapas amžinai rastų 0 darbo — vakar ir šiandien lentelėje
        // tiesiog neegzistuoja. Atgal neplečiam: tam yra `--discover`.
        if (stage === "days" || stage === "all") {
            const added = await ensureScrapeDaysForward();
            if (added > 0) log(`Pridėta naujų dienų: ${added}`);
        }

        if (stage === "all") {
            return await runPipeline(stageSpecs(runner, { rescrapeDays, trace }), { concurrency, limit, attempts });
        }
        return { [stage]: await runSingleStage(stage, runner, { concurrency, limit, rescrapeDays, trace, attempts }) };
    } finally {
        if (closeSidecar) closeSqlite(sidecar);
    }
}

/**
 * Paieškos užklausa su pakartojimais — kaip planuoklio `suBandymais`, tik
 * atradimui, kuris sukasi be planuoklio ir be DB backoff'o. Vienas nepavykęs
 * puslapis (pvz. adapterio 502 „e-Seimas JSF ViewState was not found" — e-Seimas
 * kartais numeta savo sesiją) nutraukdavo VISĄ atradimo grandinę ir procesas
 * lūždavo; iš tikrųjų užtenka perklausti tą patį puslapį.
 */
async function searchSuBandymais(api, params, attempts = DEFAULT_ATTEMPTS) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await api.searchLegalActs(params);
        } catch (error) {
            if (attempt >= attempts) throw error;
            const pauzė = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
            log(`paieška ${params.to} psl. ${params.page} bandymas ${attempt}/${attempts}`
                + ` nepavyko (${error.message}) — kartojam po ${Math.round(pauzė / 1000)} s`);
            await sleep(pauzė);
        }
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
 * puslapius (kur e-Seimas ir taip neatiduotų), tuščios kalendorinės dienos
 * praleidžiamos be nė vienos užklausos, o į "eSeimasScrapeDay" patenka tik tos
 * dienos, kuriose aktų realiai buvo.
 *
 * Sustoja tik tada, kai užklausa nebegrąžina nieko — jokios metų ribos nėra.
 *
 * @param {Object} opts
 * @param {string} [opts.from] - nuo kurios datos pradėti (numatyta: seniausia turima − 1 d.)
 * @param {string|null} [opts.floor] - neprivaloma apatinė riba
 * @param {number} [opts.maxDays] - kiek dienų daugiausia (pasižvalgymui)
 * @param {number} [opts.attempts] - kiek kartų bandyti vieną paieškos užklausą
 */
export async function discoverBackward({
    from = null, floor = null, maxDays = Infinity, api = createESeimasApi(), trace = false,
    attempts = DEFAULT_ATTEMPTS,
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
        const response = await searchSuBandymais(api, { to: frontier, page }, attempts);
        const items = response.items ?? [];
        if (!items.length) {
            log(`Giliau nei ${frontier} aktų nebėra — pabaiga`);
            break;
        }

        // e-Seimo paieškos ašis yra REGISTRACIJOS data: /v1/seimas/legal-acts
        // `from`/`to` filtruoja būtent ją, o `adopted_at` čia beveik visada null
        // (ir OpenAPI schemoje net neprivalomas). Slinktume pagal `adopted_at` —
        // riba niekada nepasikeistų ir kiekvienai kalendorinei dienai iš naujo
        // pertrauktume visą naujausių aktų sąrašą.
        const naujausia = items.find(item => item.registered_at)?.registered_at;
        if (naujausia && naujausia > frontier) {
            // Be šito, e-Seimas ignoravus datos ribą, suktumės amžinai ties naujausiais.
            throw new Error(`e-Seimas ignoravo datos ribą: gauta ${naujausia}, riba ${frontier}`);
        }

        seen += items.length;
        discovered += await upsertDiscoveredActs(items, trace && {
            source: "discover", searchTo: frontier, page, pagination: response.pagination,
        });

        // Ar šiame puslapyje jau matyti senesnė diena?
        const kita = items.map(item => item.registered_at).find(date => date && date < frontier);
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
        if (items.some(item => item.registered_at === frontier)) {
            await markDayScraped(frontier);
            days++;
        }
        frontier = kita ?? previousDay(frontier);
        page = 1;
    }

    log(`Atradimas baigtas: ${days} dienų, ${seen} eilučių, ${discovered} nauji aktai`);
    return { days, seen, discovered, frontier };
}

/**
 * DIENŲ PAŽADAI: po vieną užklausą kiekvienai dienai, įsimenant tik tai, kiek
 * rezultatų ta diena žada (`pagination.total_items`).
 *
 * Kodėl atskiras pravažiavimas, o ne šalutinis dienų etapo produktas: dienos
 * pažadą teisingai pasako TIK `from = to = diena` užklausa. `--discover` sukasi
 * su „viskas iki datos" riba, tad jos `total_items` yra viso rėžio suma (pvz.
 * 4020) ir dienai negalioja. Čia imamas tik 1-as puslapis — daugiau puslapių
 * skaičiui nereikia.
 *
 * Rezultatai guli "eSeimasDayPromise" (modules/eSeimas/dienuPazadai.sql).
 */
export async function runDayPromises({
    concurrency = DEFAULT_CONCURRENCY,
    limit = Infinity,
    from = null,
    to = null,
    refreshDays = null,
    attempts = DEFAULT_ATTEMPTS,
    api = createESeimasApi({ maxInflight: Math.min(concurrency, 6) }),
} = {}) {
    await assertDayPromiseTable();

    const spec = {
        label: "dienų pažadai",
        batchSize: 200,
        key: day => day,
        pick: (take, praleisti) =>
            pickDaysWithoutPromise({ limit: take, from, to, refreshDays, exclude: praleisti }),
        work: async (day) => {
            const started = Date.now();
            const response = await api.searchLegalActs({ from: day, to: day, page: 1 });
            const queryMs = Date.now() - started;
            const žadėta = response.pagination?.total_items ?? null;
            await recordDayPromise(day, {
                promisedItems: žadėta,
                totalPages: response.pagination?.total_pages ?? null,
                pageSize: response.pagination?.page_size ?? null,
                itemsOnFirstPage: response.items?.length ?? 0,
                queryMs,
            });
            log(`pažadas ${day} ${String(queryMs).padStart(5)}ms — žadėta ${žadėta ?? "?"}`
                + ` (${response.pagination?.total_pages ?? "?"} psl., 1-ame ${response.items?.length ?? 0} eil.)`);
        },
        // Klaidą irgi įrašom: kitaip ta pati diena amžinai grįžtų į eilę, o
        // dabar matyti, kurios dienos šaltiniui apskritai neatsiveria.
        onError: async (day, error, bandymai) => {
            log(`pažadas ${day} nepavyko po ${bandymai} bandymų: ${error.message}`);
            await recordDayPromise(day, { error });
        },
    };

    const result = await runPipeline({ promised: spec }, { concurrency, limit, attempts });
    const status = await getDayPromiseStatus();
    log(`Dienų pažadai: pamatuota ${nr(status.pamatuota)} iš ${nr(status.dienuViso)}`
        + `, žadėta iš viso ${nr(status.zadetaIsViso)} aktų`
        + (status.suKlaidomis ? `, su klaidomis ${nr(status.suKlaidomis)}` : ""));
    return { ...result.promised, ...status };
}

/** Konkreti diena – patogu užpildyti spragą arba persiskaityti iš naujo. */
export async function scrapeSingleDay(day, { api = createESeimasApi(), sidecar = openESeimasSidecar(), trace = false } = {}) {
    const runner = createRunner({ api, sidecar, concurrency: 1, trace });
    try {
        return await runner.scrapeDay(day);
    } finally {
        closeSqlite(sidecar);
    }
}

/** Vienkartinis vieno akto scrape'as – patogu rankiniam patikrinimui. */
export async function scrapeAct(category, legalActId, { api = createESeimasApi(), sidecar = openESeimasSidecar(), force = false, trace = false } = {}) {
    const runner = createRunner({ api, sidecar, concurrency: 1, force, trace });
    try {
        await runner.scrapeDocument(category, legalActId);
        await runner.scrapeEditionList(category, legalActId);
        await runner.scrapeConsolidated(category, legalActId);
        for (const edition of await pickEditionsToScrape({ limit: 10_000, category, legalActId, ignoreBackoff: true })) {
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
    const out = ["", "  e-Seimas scraper", ""];
    for (const [label, done, total] of eilutės) {
        const skaičiai = `${nr(done)} / ${nr(total)}`.padStart(w);
        const liko = total - done;
        out.push(`  ${label} ${skaičiai}  ${progressBar(done, total)}${liko > 0 ? `  liko ${nr(liko)}` : "  ✓"}`);
    }

    out.push("");
    out.push(`  Aktų iš viso        ${nr(aktai)}`);
    if (status.suKlaidomis > 0) out.push(`  Su klaidomis        ${nr(status.suKlaidomis)}`);
    if (status.saltinioBrokas > 0) {
        out.push(`  Šaltinio brokas     ${nr(status.saltinioBrokas)}  (SELECT * FROM "eSeimasSourceAnomaly")`);
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
e-Seimas scraper (sidecar: <SIDECAR_DIR>/eSeimas.sqlite)

  node modules/eSeimas/eSeimasScrape.js --stage days [--limit N] [--rescrape-days N]
  node modules/eSeimas/eSeimasScrape.js --stage documents|editions|asr|historical [--limit N]
  node modules/eSeimas/eSeimasScrape.js --stage all
  node modules/eSeimas/eSeimasScrape.js --day 2024-03-15
  node modules/eSeimas/eSeimasScrape.js --discover
  node modules/eSeimas/eSeimasScrape.js --promised [--from D] [--to D] [--limit N]
  node modules/eSeimas/eSeimasScrape.js --category TAD --act <legalActId>
  node modules/eSeimas/eSeimasScrape.js --status [--json]

  --concurrency N   lygiagrečių užklausų (numatyta ${DEFAULT_CONCURRENCY})
  --attempts N      kiek kartų bandyti kiekvieną elementą, kol skelbiam klaidą
                    (numatyta ${DEFAULT_ATTEMPTS}; pauzės ${RETRY_DELAYS_MS.map(ms => ms / 1000 + " s").join(", ")})
  --trace           sekti kiekvieno akto ATRADIMĄ lentelėje "eSeimasActDiscovery":
                    iš kurios paieškos, kurio puslapio ir kelintos eilutės aktas
                    atėjo, kiek rezultatų ta paieška žadėjo, ir ką vėliau pagal tą
                    atradimą rado --stage documents (ok / notFound / error).
                    Lentelę reikia sukurti pačiam:
                      psql "$PG_URL" -f modules/eSeimas/atradimuSekimas.sql
                    Jos neradus sekimas tyliai išsijungia.
  --promised        pereiti per visas žinomas dienas ir kiekvienai padaryti PO VIENĄ
                    užklausą (from = to = diena, 1 psl.), įrašant, kiek rezultatų
                    ta diena žada, į "eSeimasDayPromise". Tik tokios užklausos
                    skaičius ir yra dienos pažadas — --discover riba „viskas iki
                    datos" grąžina viso rėžio sumą. Lentelę reikia sukurti pačiam:
                      psql "$PG_URL" -f modules/eSeimas/dienuPazadai.sql
    --from/--to D   apriboti datų rėžį
    --refresh-days N  iš naujo matuoti dienas, tikrintas seniau nei prieš N d.
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

Konfigūracija (.env): ETAR_API_URL, ETAR_API_KEY, ESEIMAS_*, SIDECAR_DIR

Prieš pirmą paleidimą: psql -f modules/eSeimas/schema.sql
`;

if (import.meta.url === `file://${process.argv[1]}`) {
    const args = parseArgs(process.argv.slice(2));

    if (args.help || (!args.stage && !args.act && !args.day && !args.status && !args.discover && !args.promised)) {
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
                const db = openESeimasSidecar({ readonly: true });
                sidecarStats = getESeimasSidecarStats(db);
                closeSqlite(db);
            } catch { /* nėra sidecar'o — ne bėda */ }
            console.log(formatStatus(status, sidecarStats));
        }
    } else if (args.promised) {
        console.log(JSON.stringify(await runDayPromises({
            concurrency: numArg(args.concurrency, DEFAULT_CONCURRENCY),
            limit: numArg(args.limit, Infinity),
            from: typeof args.from === "string" ? args.from : null,
            to: typeof args.to === "string" ? args.to : null,
            refreshDays: args["refresh-days"] ? numArg(args["refresh-days"], null) : null,
            attempts: Math.max(1, numArg(args.attempts, DEFAULT_ATTEMPTS)),
        }), null, 2));
    } else if (args.discover) {
        // `--discover` yra savarankiškas režimas, ne etapas. Anksčiau kartu
        // paduotas `--stage` būdavo tyliai ignoruojamas — pasakom aiškiai.
        if (args.stage) log(`--stage ${args.stage} ignoruojamas: --discover yra atskiras režimas`);
        console.log(JSON.stringify(await discoverBackward({
            from: typeof args.from === "string" ? args.from : null,
            floor: typeof args.floor === "string" ? args.floor : null,
            maxDays: numArg(args.limit, Infinity),
            trace: Boolean(args.trace),
            attempts: Math.max(1, numArg(args.attempts, DEFAULT_ATTEMPTS)),
        }), null, 2));
    } else if (args.day) {
        console.log(JSON.stringify(await scrapeSingleDay(String(args.day), { trace: Boolean(args.trace) }), null, 2));
    } else if (args.act) {
        if (!args.category) throw new Error("Su --act būtinas --category, pvz. TAD");
        await scrapeAct(String(args.category), String(args.act), {
            force: Boolean(args.force), trace: Boolean(args.trace),
        });
        log(`Aktas ${args.category}/${args.act} nuskaitytas`);
    } else {
        const results = await runStage(String(args.stage), {
            concurrency: numArg(args.concurrency, DEFAULT_CONCURRENCY),
            limit: numArg(args.limit, Infinity),
            rescrapeDays: args["rescrape-days"] ? numArg(args["rescrape-days"], null) : null,
            force: Boolean(args.force),
            trace: Boolean(args.trace),
            attempts: Math.max(1, numArg(args.attempts, DEFAULT_ATTEMPTS)),
        });
        console.log(JSON.stringify(results, null, 2));
    }
    process.exit(0);
}
