import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("eTar", { operation: "eTarApi" });
import config from "../../utils/config.js";
import { log } from "../../utils/log.js";
import { sleep } from "../../utils/time.js";

// Klientas „Stateless e-TAR API" adapteriui — jo OpenAPI: <ETAR_API_URL>/openapi.json.
// Adapteris pats eina į e-TAR gyvai ir nieko nesaugo, tad visas kešavimas ir
// atkartojamumas — mūsų pusėje (Postgres + sidecar).
//
//   ETAR_API_URL / config.eTarApiUrl — bazinis adresas, pvz. http://10.1.10.2:8080
//   ETAR_API_KEY / config.eTarApiKey — Bearer raktas, jei adapteris jo reikalauja

/** Adapteris strict — jei šaltinis nepažįstamos formos, gaunam 502 su Error body. */
export class ETarApiError extends Error {
    constructor(message, { status, url, body, retryAfterMs } = {}) {
        super(message);
        this.name = "ETarApiError";
        this.status = status ?? null;
        this.url = url;
        this.body = body ?? null;
        /** `Retry-After` iš atsakymo, jei adapteris jį nurodė (ms). */
        this.retryAfterMs = retryAfterMs ?? null;
    }
}

/** `Retry-After`: sekundės arba data. Grąžina ms arba null. */
function retryAfterMs(res) {
    const raw = res.headers.get("retry-after");
    if (!raw) return null;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(raw);
    return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/**
 * e-TAR aiškiai sako, kad prašomo dokumento nėra. Du atvejai, skiriami pagal
 * `body.error`:
 *   `no_current_consolidated_edition`             — /asr: aktualios suvestinės nėra;
 *   `historical_consolidated_edition_unavailable` — /{edition}: tokenas pasenęs,
 *      e-TAR tuo adresu jau grąžina bendrą redakcijų sąrašą; šviežio tokeno
 *      reikia ieškoti /editions atsakyme (žr. eTarScrape.scrapeHistoricalEdition).
 */
export class ETarNotFoundError extends ETarApiError {
    constructor(message, details) {
        super(message, details);
        this.name = "ETarNotFoundError";
    }
}

// Adapteris turi ribotą parserių eilę ir perkrautas atsako 503 „busy — Parser
// worker queue is full" (arba 429). Tai ne klaida, o prašymas palaukti: aktas
// niekur nedingo, tiesiog šiuo metu nėra kam jo išanalizuoti.
const BUSY_STATUSES = new Set([429, 503]);
/** Ilgiausia pauzė tarp bandymų, kai adapteris užimtas. */
const BUSY_MAX_DELAY = 60_000;
/** Kiek kartų verta perklausti užimtą adapterį, kol pasiduodam. */
const BUSY_ATTEMPTS = 20;
/** Kas kiek laiko primenam, kad vis dar laukiam (kad procesas neatrodytų miręs). */
const BUSY_LOG_INTERVAL = 15_000;
/** Po kiek sėkmingų atsakymų iš eilės vėl praplatinam srautą. */
const GROW_AFTER_OK = 20;

export function createETarApi({
    baseUrl = config.eTarApiUrl,
    apiKey = config.eTarApiKey,
    timeoutMs = 120_000,
    /**
     * Kiek užklausų laikom ore vienu metu. Adapteris turi savo `max_inflight`
     * (matosi jo žurnale) ir viską virš jo iškart atmeta su 503 — tad prasmės
     * siųsti daugiau nėra, tik pridarom triukšmo sau ir jam.
     */
    maxInflight = 6,
} = {}) {
    if (!baseUrl) {
        throw new Error("Nenustatytas ETAR_API_URL (config.eTarApiUrl) — e-TAR adapterio adresas");
    }
    const root = baseUrl.replace(/\/+$/, "");

    // ── srauto ribotuvas
    //
    // 503 „busy" reiškė ne tai, kad adapteris lėtas, o tai, kad jo eilė pilna
    // MŪSŲ užklausų (jo žurnale — `inflight: 8, max_inflight: 8`, atsakymas per
    // 1 ms). Tad laikom savo langą: kiekvienas „busy" jį susiaurina, o po
    // sėkmingų atsakymų serijos jis vėl po vieną plečiasi — kaip perkrovos
    // valdymas tinkle.
    let limit = Math.max(1, maxInflight);
    let inflight = 0;
    let okStreak = 0;
    const laukiantys = [];

    async function acquire() {
        if (inflight < limit) { inflight += 1; return; }
        await new Promise(resolve => laukiantys.push(resolve));
        inflight += 1;
    }

    function release() {
        inflight -= 1;
        if (inflight < limit) laukiantys.shift()?.();
    }

    // Bendras stabdys VISIEMS šio kliento darbininkams. Be jo kiekvienas jų
    // perklausinėja atskirai ir perkrautą adapterį daužo lygiai taip pat
    // tankiai, kaip iki 503 — eilė nespėja išsivalyti. Dabar pirmas gautas
    // „busy" sustabdo visus iki `busyUntil`, o pauzė ilgėja, kol adapteris
    // atsigauna.
    let busyUntil = 0;
    let busyStreak = 0;
    let busySince = 0;
    let busyLoggedAt = 0;

    async function waitWhileBusy() {
        for (let left = busyUntil - Date.now(); left > 0; left = busyUntil - Date.now()) {
            await sleep(left);   // pauzė gali pailgėti belaukiant — tikrinam iš naujo
        }
    }

    /** Pažymi, kad adapteris užimtas, ir grąžina, kiek laukiam (ms). */
    function markBusy(retryAfterMs) {
        busyStreak += 1;
        okStreak = 0;
        if (!busySince) busySince = Date.now();
        // Siaurinam langą — kitaip tas pats užklausų kiekis vėl užpildys eilę.
        limit = Math.max(1, limit - 1);
        // Eksponentinis atsitraukimas su „triukšmu", kad darbininkai negrįžtų
        // visi kaip vienas. `Retry-After` (jei adapteris jį duoda) — viršesnis.
        const base = retryAfterMs ?? Math.min(BUSY_MAX_DELAY, 2_000 * 2 ** (busyStreak - 1));
        const delay = Math.round(base * (0.8 + Math.random() * 0.4));
        busyUntil = Math.max(busyUntil, Date.now() + delay);
        return delay;
    }

    /** Sėkmingas atsakymas: paskelbiam atsigavimą ir po truputį plečiam srautą. */
    function markOk() {
        if (busySince) {
            log(`e-TAR adapteris atsigavo po ${Math.round((Date.now() - busySince) / 1000)} s`
                + ` (srautas — ${limit} užklausos vienu metu)`);
            busySince = 0;
            busyLoggedAt = 0;
        }
        busyStreak = 0;
        if (++okStreak >= GROW_AFTER_OK && limit < maxInflight) {
            okStreak = 0;
            limit += 1;
            laukiantys.shift()?.();
        }
    }

    // Nepavykusi užklausa NĖRA kartojama čia — klaida grąžinama iškart, o kada
    // bandyti iš naujo, sprendžia DB (`failureCount`/`retryAfter` ant
    // "eTarLegalActScrape" ir "eTarEdition"). Anksčiau čia sukosi 4 bandymai su
    // 5/10/15 s pauzėmis, ir nuolat lūžtantis elementas (pvz. adapterio 502
    // „Requested consolidated edition is unavailable" — jis lūžta ir po 15 s
    // lygiai taip pat) pusę minutės laikė darbininką ir be reikalo triskart
    // daužė šaltinį. Backoff'as DB lygyje tą patį daro geriau: elementas
    // grįžta po 30+ min, o procesas tuo metu dirba kitus.
    //
    // Vienintelė išimtis — 429/503 „busy": tai ne klaida, o prašymas palaukti
    // (aktas niekur nedingo, tik nėra kam jo išanalizuoti), tad čia laukiam.
    async function request(pathname, params) {
        const url = new URL(root + pathname);
        for (const [key, value] of Object.entries(params ?? {})) {
            if (value != null && value !== "") url.searchParams.set(key, String(value));
        }

        for (let busyAttempt = 0;;) {
            await waitWhileBusy();

            let error = null;
            await acquire();
            try {
                const body = await requestOnce(url);
                markOk();
                return body;
            } catch (e) {
                error = e;
            } finally {
                release();
            }

            if (!(error instanceof ETarApiError) || !BUSY_STATUSES.has(error.status)) throw error;

            if (++busyAttempt > BUSY_ATTEMPTS) throw error;
            const delay = markBusy(error.retryAfterMs);
            // Vienas įrašas bangai, o ne po vieną kiekvienam darbininkui;
            // paskui — priminimas kas 15 s, kad procesas neatrodytų miręs.
            if (Date.now() - busyLoggedAt > BUSY_LOG_INTERVAL) {
                const jau = busyLoggedAt
                    ? `, iš viso jau ${Math.round((Date.now() - busySince) / 1000)} s`
                    : "";
                busyLoggedAt = Date.now();
                log(`e-TAR adapteris užimtas (${error.status}) — stabdoma`
                    + ` ${Math.round(delay / 1000)} s, srautas sumažintas iki ${limit}${jau}`);
            }
        }
    }

    async function requestOnce(url) {
        const res = await scrapeFetch(url, {
            headers: {
                Accept: "application/json",
                ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
            },
            signal: AbortSignal.timeout(timeoutMs),
        });

        const text = await res.text();
        let body = null;
        try {
            body = text ? JSON.parse(text) : null;
        } catch {
            // Ne JSON – paliekam null, žinutė sudėliojama iš statuso.
        }

        if (!res.ok) {
            const message = `e-TAR API ${res.status} ${url.pathname}${body?.error ? `: ${body.error}` : ""}`
                + (body?.message ? ` — ${body.message}` : "");
            const details = { status: res.status, url: url.href, body, retryAfterMs: retryAfterMs(res) };
            throw res.status === 404 ? new ETarNotFoundError(message, details) : new ETarApiError(message, details);
        }
        if (body == null) {
            throw new ETarApiError(`e-TAR API grąžino ne JSON (${url.pathname})`, { status: res.status, url: url.href });
        }
        return body;
    }

    return {
        baseUrl: root,

        /** Vienas 20 eilučių puslapis; `page` yra 1-based. */
        searchLegalActs({ from = "", to = "", mode = "acts", page = 1 } = {}) {
            return request("/v1/legal-acts", { from, to, mode, page });
        },

        /** Originalus aktas. */
        getLegalAct(id) {
            return request(`/v1/legal-acts/${encodeURIComponent(id)}`);
        },

        /** Galiojanti suvestinė redakcija; meta ETarNotFoundError, jei jos nėra. */
        getConsolidatedEdition(id) {
            return request(`/v1/legal-acts/${encodeURIComponent(id)}/asr`);
        },

        /** Suvestinių redakcijų sąrašas pagal datą. */
        getEditionList(id) {
            return request(`/v1/legal-acts/${encodeURIComponent(id)}/editions`);
        },

        /** Konkreti istorinė suvestinė; `edition` — neskaidrus tokenas iš /editions. */
        getHistoricalConsolidatedEdition(id, edition) {
            return request(`/v1/legal-acts/${encodeURIComponent(id)}/${encodeURIComponent(edition)}`);
        },
    };
}
