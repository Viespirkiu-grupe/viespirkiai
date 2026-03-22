import { parseHTML } from "linkedom";

export const NUSKAITYMO_VERSIJA = 9;

const DATE_KEYS_CFTDPSWS = new Set([
    "susipazinimoSuPasiulymaisData",
    "paaiskinimuTerminoPabaiga",
    "pasiulymuArbaParaiskuDalyvautiPirkimePateikimoTerminas",
    "paskelbimoIrArbaKvietimoData",
    "laimetojoNustatymoData",
    "pasiulymuPateikimoTerminas",
    "kvsGaliojimoDataIrLaikas",
    "dpsGaliojimoDataIrLaikas",
]);

const DATE_KEYS_PMC = new Set([
    "susipazinimoSuPasiulymaisData",
    "paaiskinimuTerminoPabaiga",
    "pasiulymuArbaParaiskuDalyvautiPirkimePateikimoTerminas",
    "paskelbimoIrArbaKvietimoData",
    "laimetojoNustatymoData",
    "pasiulymuPateikimoTerminas",
]);

const DATE_KEYS_CFTWS = new Set([
    "susipazinimoSuPasiulymaisData",
    "paaiskinimuTerminoPabaiga",
    "pasiulymuArbaParaiskuDalyvautiPirkimePateikimoTerminas",
    "paskelbimoIrArbaKvietimoData",
    "laimetojoNustatymoData",
]);

const LONG_VERTINIMO_KEY =
    "pasiulymuVertinimoKriterijaiPasirinktasVertinimoKriterijusBusTaikomasVisomsPirkimoDalimskategorijoms";

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

/**
 * Converts label text into a normalized camelCase key.
 * Lithuanian letters are transliterated and punctuation removed.
 * @param {string} str
 * @returns {string}
 */
function toCamelCase(str) {
    const map = {
        ą: "a",
        č: "c",
        ę: "e",
        ė: "e",
        į: "i",
        š: "s",
        ų: "u",
        ū: "u",
        ž: "z",
        Ą: "A",
        Č: "C",
        Ę: "E",
        Ė: "E",
        Į: "I",
        Š: "S",
        Ų: "U",
        Ū: "U",
        Ž: "Z",
    };
    str = str.replace(/./g, (c) => map[c] || c);
    str = str.replace(/is\(-iu\)/gi, "iu");
    return str
        .replace(/[^\w\s]/g, "")
        .trim()
        .split(/\s+/)
        .map((word, i) =>
            i === 0
                ? word.toLowerCase()
                : word[0].toUpperCase() + word.slice(1),
        )
        .join("");
}

/**
 * Converts dd/mm/yyyy to yyyy-mm-dd.
 * @param {string | null | undefined} dateStr
 * @returns {string | null}
 */
function formatShortDate(dateStr) {
    if (!dateStr) return null;
    const [d, m, y] = dateStr.trim().split("/");
    if (!d || !m || !y) return null;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * Converts dd/mm/yyyy hh:mm(:ss) to yyyy-mm-dd hh:mm(:ss).
 * @param {string | null | undefined} dateStr
 * @returns {string | null}
 */
function formatDate(dateStr) {
    if (!dateStr) return null;
    const [datePart, timePart] = dateStr.trim().split(" ");
    const [d, m, y] = datePart.split("/");
    if (!d || !m || !y) return null;
    return timePart
        ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")} ${timePart}`
        : `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * Parses a numeric value from text, converting commas to dots.
 * Returns null for non-positive or invalid values.
 * @param {string} text
 * @returns {number | null}
 */
function parseNumberValue(text) {
    const n = Number(text.replace(",", ".").replace(/\.$/, "").trim());
    return n > 0 ? n : null;
}

/**
 * Extracts pirkimo vykdytojas id and name from a definition list element.
 * @param {Element} dd
 * @param {Record<string, any>} result
 * @returns {void}
 */
function extractPirkimoVykdytojas(dd, result) {
    const a = dd.querySelector("a");
    if (!a) return;
    const idMatch = (a.getAttribute("href") || "").match(/id=(\d+)/);
    result.pirkimoVykdytojasId = idMatch ? idMatch[1] : null;
    result.pirkimoVykdytojasPavadinimas = a.textContent.trim();
}

/**
 * Parses BVPŽ code+name pairs from a dd element.
 * Handles both multi-line (one code per line) and inline (multiple codes per line) formats.
 * Splits on lookahead before 8-digit codes so commas inside names are safe.
 * @param {Element} dd
 * @returns {{ bvpzKodai: string[], bvpzKodaiPavadinimai: string[] }}
 */
function parseBvpzKodai(dd) {
    const bvpzKodai = [];
    const bvpzKodaiPavadinimai = [];

    const lines = dd.textContent
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

    for (const line of lines) {
        const parts = line
            .split(/(?=\d{8}\s*-)/)
            .map((p) => p.trim())
            .filter(Boolean);
        for (const part of parts) {
            const m = part.match(/^(\d{8})\s*-\s*(.+)$/);
            if (!m) continue;
            bvpzKodai.push(m[1]);
            bvpzKodaiPavadinimai.push(m[2].trim());
        }
    }

    return { bvpzKodai, bvpzKodaiPavadinimai };
}

/**
 * Renames the overlong pasiulymuVertinimoKriterijai key to a short form.
 * Mutates result in place.
 * @param {Record<string, any>} result
 * @returns {void}
 */
function fixVertinimoKriterijai(result) {
    if (LONG_VERTINIMO_KEY in result) {
        result.pasiulymuVertinimoKriterijai = result[LONG_VERTINIMO_KEY];
        delete result[LONG_VERTINIMO_KEY];
    }
}

/**
 * Shared dl.row parser. Iterates dt/dd pairs and delegates to field-specific
 * handlers based on the camelCase key. Caller provides a `handleField` callback
 * for parser-specific logic; returning `false` falls through to the default handler.
 *
 * @param {string} text - Raw HTML of the page.
 * @param {(key: string, dd: Element, ddText: string, result: Record<string, any>) => boolean} handleField
 *   Return true if the field was handled, false to fall through to default assignment.
 * @returns {Record<string, any> | null}
 */
function parseDlRow(text, handleField) {
    const { document } = parseHTML(text);
    const lentele = document.querySelector("dl.row");
    if (!lentele) return null;

    const result = {};
    const dts = lentele.querySelectorAll("dt");
    const dds = lentele.querySelectorAll("dd");

    for (let i = 0; i < dts.length; i++) {
        const key = toCamelCase(dts[i].textContent);
        const dd = dds[i];
        const ddText = dd.textContent.trim();

        if (key === "pirkimoVykdytojoPavadinimas") {
            extractPirkimoVykdytojas(dd, result);
        } else if (!handleField(key, dd, ddText, result)) {
            // Special-case: TED links must be an array of full hrefs (not truncated link text)
            if (key === "tedNuorodosIPaskelbtusPranesimus") {
                const urls = Array.from(dd.querySelectorAll("a"))
                    .map((a) => (a.getAttribute("href") || "").trim())
                    .filter(Boolean);
                result[key] = urls.length ? urls : [];
            } else {
                result[key] = ddText;
            }
        }
    }

    fixVertinimoKriterijai(result);
    return result;
}

// ---------------------------------------------------------------------------
// Public parsers
// ---------------------------------------------------------------------------

/**
 * Parses a CfTDPSWS purchase details page.
 * @param {string} text
 * @returns {Promise<Record<string, any> | null>}
 */
export async function parseCfTDPSWS(text) {
    return parseDlRow(text, (key, dd, ddText, result) => {
        if (key === "bvpzKodai") {
            Object.assign(result, parseBvpzKodai(dd));
            return true;
        }
        if (
            key === "numatomaVerteEUR" ||
            key === "suteiktaVertemaksimaliDPSVerte" ||
            key === "bendraSutarciuVerte"
        ) {
            result[key] = parseNumberValue(ddText);
            return true;
        }
        if (key.startsWith("kategorijadalisPavadinimas")) {
            (result.kategorijaDalys ??= []).push(ddText);
            return true;
        }
        if (key.startsWith("daliuPavadinimas")) {
            (result.daliuPavadinimai ??= []).push(ddText);
            return true;
        }
        if (DATE_KEYS_CFTDPSWS.has(key)) {
            result[key] = formatDate(ddText);
            return true;
        }
        return false;
    });
}

/**
 * Parses a PMC purchase details page.
 * @param {string} text
 * @returns {Promise<Record<string, any> | null>}
 */
export async function parsePmc(text) {
    return parseDlRow(text, (key, dd, ddText, result) => {
        if (key === "bvpzKodai") {
            Object.assign(result, parseBvpzKodai(dd));
            return true;
        }
        if (key === "numatomaVerteEUR") {
            result[key] = parseNumberValue(ddText);
            return true;
        }
        if (DATE_KEYS_PMC.has(key)) {
            result[key] = formatDate(ddText);
            return true;
        }
        return false;
    });
}

/**
 * Parses a CfTWS purchase details page.
 * @param {string} text
 * @returns {Promise<Record<string, any> | null>}
 */
export async function parseCfTWS(text) {
    return parseDlRow(text, (key, dd, ddText, result) => {
        if (key === "bvpzKodai") {
            Object.assign(result, parseBvpzKodai(dd));
            return true;
        }
        if (key === "numatomaVerteEUR") {
            result[key] = parseNumberValue(ddText);
            return true;
        }
        if (DATE_KEYS_CFTWS.has(key)) {
            result[key] = formatDate(ddText);
            return true;
        }
        return false;
    });
}

/**
 * Parses a contract notices table (#T01).
 * @param {string} htmlText
 * @returns {Promise<Array<object>>}
 */
export async function parseSkelbimai(htmlText) {
    const { document } = parseHTML(htmlText);
    const skelbimai = [];
    const tbody = document.querySelector("#T01 > tbody");
    if (!tbody) return skelbimai;

    for (const row of tbody.querySelectorAll("tr")) {
        const tds = row.querySelectorAll("td");
        if (tds.length < 5) continue;

        const a = tds[0].querySelector("a");
        const externalIdInput = tds[0].querySelector("input[id^=external_id_]");
        const isLinkedInput = tds[0].querySelector("input[id^=islinked]");

        skelbimai.push({
            tipas: a?.textContent.trim() ?? null,
            downloadHref: a?.getAttribute("href") ?? null,
            externalId: externalIdInput?.value ?? null,
            isLinked: isLinkedInput?.value === "true",
            ikelimoData: formatDate(tds[1].textContent.trim()),
            kalba: tds[2].textContent.trim(),
            statusas: tds[3].textContent.trim(),
            paskelbimoData: formatDate(tds[4].textContent.trim()),
        });
    }

    return skelbimai;
}

/**
 * Parses a contract documents list (#T02).
 * @param {string} htmlText
 * @returns {Promise<Array<object>>}
 */
export async function parseFailai(htmlText) {
    const { document } = parseHTML(htmlText);
    const failai = [];
    const tbody = document.querySelector("#T02 > tbody");
    if (!tbody) return failai;

    for (const row of tbody.querySelectorAll("tr")) {
        const tds = row.querySelectorAll("td");
        if (tds.length < 3) continue;

        const a = tds[2].querySelector("a");
        const onclick = a?.getAttribute("onclick");
        const idMatch = onclick?.match(/'(\d+)'/);

        const na = (td) => {
            const t = td?.textContent.trim();
            return t === "N/A" || !t ? null : t;
        };

        failai.push({
            papildymoId: na(tds[0]),
            pavadinimas: tds[1].textContent.trim() || null,
            dokumentasId: idMatch ? Number(idMatch[1]) : null,
            dokumentasPavadinimas: a?.textContent.trim() ?? null,
            aprasymas: na(tds[3]),
            kalba: tds[4]?.textContent.trim() || null,
            versijosExists: Boolean(tds[5]?.querySelector("a")),
        });
    }

    return failai;
}

/**
 * Parses a document versions list (#T02).
 * @param {string} htmlText
 * @returns {Promise<Array<object>>}
 */
export async function parseVersijos(htmlText) {
    const { document } = parseHTML(htmlText);
    const versijos = [];
    const tbody = document.querySelector("#T02 > tbody");
    if (!tbody) return versijos;

    for (const row of tbody.querySelectorAll("tr")) {
        const tds = row.querySelectorAll("td");
        if (tds.length < 5) continue;

        const a = tds[2].querySelector("a");
        const versionIdMatch = a
            ?.getAttribute("href")
            ?.match(/versionId=(\d+)/);

        const na = (td) => {
            const t = td?.textContent.trim();
            return t === "N/A" || !t ? null : t;
        };

        versijos.push({
            papildymoId: na(tds[0]),
            pavadinimas: tds[1].textContent.trim() || null,
            versionId: versionIdMatch ? Number(versionIdMatch[1]) : null,
            dokumentoVersija: tds[3].textContent.trim() || null,
            pakeitimai: tds[4].textContent.trim() || null,
            ikelimoData: formatShortDate(tds[5]?.textContent.trim()),
            kalba: tds[6]?.textContent.trim() || null,
            rengejas: tds[7]?.textContent.trim() || null,
            statusas: tds[8]?.textContent.trim() || null,
        });
    }

    return versijos;
}

export function extractTedNoticeNumber(url) {
    const match = url.match(/NOTICE:(\d{6}-\d{4})/);
    return match?.[1] || null;
}
