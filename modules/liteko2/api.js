/*
LITEKO2 viešojo API klientas (https://liteko-api-pub.teismas.lt/v3/api-docs).

Autentikacijos nereikia. Puslapiavimas – Spring `Pageable` (page/size/sort),
serveris `size` apkarpo iki 100, todėl didesnių neprašom.
*/

const BASE = "https://liteko-api-pub.teismas.lt";
export const PUSLAPIO_DYDIS = 100;

const HEADERS = {
    Accept: "application/json",
    "User-Agent": "viespirkiai.org (LITEKO2 open data client)",
};

const TIMEOUT_MS = 60_000;
const BANDYMAI = 4;

/** Miego pauzė tarp pakartotinių bandymų (eksponentinė). */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Vienas API kvietimas su timeout'u ir kartojimu (5xx / tinklo klaidos).
 * @param {string} path - kelias nuo bazinio URL, pvz. „/v1/decisions".
 * @param {object} [options]
 * @param {boolean} [options.raw] - grąžinti `Response` (failų atsisiuntimui).
 */
async function apiFetch(path, { raw = false } = {}) {
    const url = path.startsWith("http") ? path : BASE + path;
    let lastError;

    for (let bandymas = 1; bandymas <= BANDYMAI; bandymas++) {
        try {
            const response = await fetch(url, {
                headers: HEADERS,
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });

            // 404 nėra laikina klaida — grąžinam null, kad skambintojas galėtų
            // pažymėti dingusį sprendimą ir eiti toliau.
            if (response.status === 404) return null;

            if (!response.ok) {
                const laikina = response.status >= 500 || response.status === 429;
                const error = new Error(`LITEKO2 ${response.status} ${url}`);
                if (!laikina) throw error;
                lastError = error;
            } else {
                return raw ? response : await response.json();
            }
        } catch (error) {
            if (error?.message?.startsWith("LITEKO2 4")) throw error;
            lastError = error;
        }

        if (bandymas < BANDYMAI) await sleep(1000 * 2 ** (bandymas - 1));
    }

    throw lastError;
}

function decisionsQuery({ page, size, sort, dateFrom, dateTo, ...filters }) {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("size", String(size));
    if (sort) params.set("sort", sort);
    if (dateFrom) params.set("decisionDateFrom", dateFrom);
    if (dateTo) params.set("decisionDateTo", dateTo);
    for (const [key, value] of Object.entries(filters)) {
        if (value != null && value !== "") params.set(key, String(value));
    }
    return params.toString();
}

/**
 * Puslapiuoja sprendimų sąrašą ir atiduoda po vieną santrauką.
 * Rikiuojam pagal `decisionDate,asc` — taip naujai atsiradę įrašai lipa į galą
 * ir puslapiuojant nepraslysta pro akis.
 * @param {object} [options]
 * @param {boolean} [options.atsaukti] - imti /v1/decisions/canceled sąrašą.
 * @param {string} [options.dateFrom] - „YYYY-MM-DD" (imtinai).
 * @param {string} [options.dateTo] - „YYYY-MM-DD" (imtinai).
 * @returns {AsyncGenerator<object>} DecisionSummaryResponse įrašai.
 */
export async function* iterateDecisions({
    atsaukti = false,
    dateFrom,
    dateTo,
    size = PUSLAPIO_DYDIS,
} = {}) {
    const path = atsaukti ? "/v1/decisions/canceled" : "/v1/decisions";
    let page = 0;
    let totalPages = 1;

    while (page < totalPages) {
        const query = decisionsQuery({ page, size, sort: "decisionDate,asc", dateFrom, dateTo });
        const data = await apiFetch(`${path}?${query}`);
        const content = data?.content ?? [];
        totalPages = data?.totalPages ?? 0;

        for (const item of content) yield item;

        if (!content.length) break;
        page++;
    }
}

/** Sprendimo metaduomenys su teisėjais, kategorijomis, šalimis ir failais. */
export async function fetchDecision(liteko2Id) {
    return apiFetch(`/v1/decisions/${encodeURIComponent(liteko2Id)}`);
}

/** Sprendimo failų sąrašas (tas pats, ką duoda `decisionFiles`, tik su int dydžiu). */
export async function fetchDecisionFiles(liteko2Id) {
    return apiFetch(`/v1/decisions/${encodeURIComponent(liteko2Id)}/files`);
}

/**
 * Sprendimo failo kelias. API jį atiduoda kaip `fileUrl`, bet jis visada
 * atkuriamas iš sprendimo id ir failo vardo, tad DB jo nesaugom.
 */
export function failoUrl(liteko2Id, failoVardas) {
    return `/v1/decisions/${encodeURIComponent(liteko2Id)}/files/${encodeURIComponent(failoVardas)}`;
}

/** Absoliutus failo URL (nuorodoms už scraperio ribų). */
export function failoAbsoliutusUrl(liteko2Id, failoVardas) {
    return BASE + failoUrl(liteko2Id, failoVardas);
}

/**
 * Atsisiunčia sprendimo failą.
 * @param {string} fileUrl - `fileUrl` iš API (jau URL-encoded kelias).
 * @returns {Promise<{buffer: Buffer, contentType: string}|null>}
 */
export async function fetchDecisionFile(fileUrl) {
    const response = await apiFetch(fileUrl, { raw: true });
    if (!response) return null;
    return {
        buffer: Buffer.from(await response.arrayBuffer()),
        contentType: response.headers.get("content-type") ?? "",
    };
}

/** Klasifikatoriai: „courts" | „case-types" | „case-categories" | „document-types". */
export async function fetchClassifier(name) {
    return apiFetch(`/v1/classifiers/${name}`);
}
