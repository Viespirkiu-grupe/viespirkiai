import { parseHTML } from "linkedom";

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

    // Replace Lithuanian letters
    str = str.replace(/./g, (c) => map[c] || c);

    // Replace only (-iu) with "iu"
    str = str.replace(/is\(-iu\)/gi, "iu");

    return str
        .replace(/[^\w\s]/g, "") // remove other punctuation
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
 * Extracts buyer details from a definition list item.
 * @param {Element} dd
 * @param {Record<string, any>} result
 * @returns {void}
 */
function extractPirkimoVykdytojas(dd, result) {
    const a = dd.querySelector("a");
    if (!a) return;

    const href = a.getAttribute("href") || "";
    const idMatch = href.match(/id=(\d+)/);
    result.pirkimoVykdytojasId = idMatch ? idMatch[1] : null;
    result.pirkimoVykdytojasPavadinimas = a.textContent.trim();
}

/**
 * Parses CfTDPSWS purchase details page.
 * @param {string} text
 * @returns {Promise<Record<string, any> | null>}
 */
export async function parseCfTDPSWS(text) {
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
        } else if (key === "bvpzKodai") {
            const lines = dd.textContent
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean);

            result.bvpzKodai = [];
            result.bvzpKodaiPavadinimai = [];

            for (const line of lines) {
                // match all occurrences in the line
                const matches = line.matchAll(/(\d{8})\s*-\s*([^0-9]+)/g);
                for (const m of matches) {
                    const [, kodas, pavadinimas] = m;
                    result.bvpzKodai.push(kodas);
                    result.bvzpKodaiPavadinimai.push(pavadinimas.trim());
                }
            }
        } else if (
            key === "numatomaVerteEUR" ||
            key == "suteiktaVertemaksimaliDPSVerte" ||
            key == "bendraSutarciuVerte"
        ) {
            result[key] = parseNumberValue(ddText);
        } else if (key.startsWith("kategorijadalisPavadinimas")) {
            if (!result.kategorijaDalys) result.kategorijaDalys = [];
            result.kategorijaDalys.push(ddText);
        } else if (key.startsWith("daliuPavadinimas")) {
            if (!result.daliuPavadinimai) result.daliuPavadinimai = [];
            result.daliuPavadinimai.push(ddText);
        } else if (DATE_KEYS_CFTDPSWS.has(key)) {
            result[key] = formatDate(ddText);
        } else if (key === "pirkimuSuvestinesNuoroda") {
            result[key] = ddText;
        } else {
            result[key] = ddText;
        }

        if (
            key ===
            "pasiulymuVertinimoKriterijaiPasirinktasVertinimoKriterijusBusTaikomasVisomsPirkimoDalimskategorijoms"
        ) {
            result["pasiulymuVertinimoKriterijai"] = ddText;
            delete result[key];
        }
    }

    return result;
}

/**
 * Parses PMC purchase details page.
 * @param {string} text
 * @returns {Promise<Record<string, any> | null>}
 */
export async function parsePmc(text) {
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
        } else if (key === "bvpzKodai") {
            const lines = dd.textContent
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean);

            result.bvpzKodai = [];
            result.bvzpKodaiPavadinimai = [];

            for (const line of lines) {
                const m = line.match(/^(\d{8})\s*-\s*(.+)$/);
                if (!m) continue;

                const [, kodas, pavadinimas] = m;
                result.bvpzKodai.push(kodas);
                result.bvzpKodaiPavadinimai.push(pavadinimas.trim());
            }
        } else if (key === "numatomaVerteEUR") {
            result[key] = parseNumberValue(ddText);
        } else if (DATE_KEYS_PMC.has(key)) {
            result[key] = formatDate(ddText);
        } else if (key === "pirkimuSuvestinesNuoroda") {
            result[key] = ddText;
        } else {
            result[key] = ddText;
        }

        if (
            key ===
            "pasiulymuVertinimoKriterijaiPasirinktasVertinimoKriterijusBusTaikomasVisomsPirkimoDalimskategorijoms"
        ) {
            result["pasiulymuVertinimoKriterijai"] = ddText;
            delete result[key];
        }
    }

    return result;
}

/**
 * Parses CfTWS purchase details page.
 * @param {string} text
 * @returns {Promise<Record<string, any> | null>}
 */
export async function parseCfTWS(text) {
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
        } else if (key === "bvpKodai") {
            const items = dd.textContent.split(",");
            result.bvpzKodai = [];
            result.bvzpKodaiPavadinimai = [];
            for (const item of items) {
                const [kodas, ...pavadinimasParts] = item.trim().split("-");
                result.bvpzKodai.push(kodas.trim());
                result.bvzpKodaiPavadinimai.push(
                    pavadinimasParts.join("-").trim(),
                );
            }
        } else if (key === "numatomaVerteEUR") {
            result[key] = parseNumberValue(ddText);
        } else if (DATE_KEYS_CFTWS.has(key)) {
            result[key] = formatDate(ddText);
        } else if (key === "pirkimuSuvestinesNuoroda") {
            result[key] = ddText;
        } else {
            result[key] = ddText;
        }

        if (
            key ===
            "pasiulymuVertinimoKriterijaiPasirinktasVertinimoKriterijusBusTaikomasVisomsPirkimoDalimskategorijoms"
        ) {
            result["pasiulymuVertinimoKriterijai"] = ddText;
            delete result[key];
        }
    }

    return result;
}

/**
 * Parses contract notices table.
 * @param {string} htmlText
 * @returns {Promise<Array<object>>}
 */
export async function parseSkelbimai(htmlText) {
    const { document } = parseHTML(htmlText);
    const skelbimai = [];
    const skelbimuLentele = document.querySelector("#T01 > tbody");
    if (!skelbimuLentele) return skelbimai;

    const skelbimaiRows = skelbimuLentele.querySelectorAll("tr");

    for (const row of skelbimaiRows) {
        const tds = row.querySelectorAll("td");
        if (tds.length < 5) continue;

        const item = {};

        const a = tds[0].querySelector("a");
        item.tipas = a?.textContent.trim() ?? null;
        item.downloadHref = a?.getAttribute("href") ?? null;

        const externalIdInput = tds[0].querySelector("input[id^=external_id_]");
        item.externalId = externalIdInput?.value ?? null;

        const isLinkedInput = tds[0].querySelector("input[id^=islinked]");
        item.isLinked = isLinkedInput?.value === "true";

        item.ikelimoData = formatDate(tds[1].textContent.trim());
        item.kalba = tds[2].textContent.trim();
        item.statusas = tds[3].textContent.trim();
        item.paskelbimoData = formatDate(tds[4].textContent.trim());

        skelbimai.push(item);
    }

    return skelbimai;
}

/**
 * Parses contract documents list.
 * @param {string} htmlText
 * @returns {Promise<Array<object>>}
 */
export async function parseFailai(htmlText) {
    const { document } = parseHTML(htmlText);
    const failai = [];
    const failaiLentele = document.querySelector("#T02 > tbody");
    if (!failaiLentele) return failai;

    const rows = failaiLentele.querySelectorAll("tr");

    for (const row of rows) {
        const tds = row.querySelectorAll("td");
        if (tds.length < 3) continue;

        const file = {};

        file.papildymoId =
            tds[0].textContent.trim() === "N/A"
                ? null
                : tds[0].textContent.trim();
        file.pavadinimas = tds[1].textContent.trim() || null;

        const a = tds[2].querySelector("a");
        if (a) {
            const onclick = a.getAttribute("onclick");
            const match = onclick?.match(/'(\d+)'/);
            file.dokumentasId = match ? Number(match[1]) : null;
            file.dokumentasPavadinimas = a.textContent.trim();
        }

        file.aprasymas =
            tds[3]?.textContent.trim() === "N/A"
                ? null
                : tds[3]?.textContent.trim();
        file.kalba = tds[4]?.textContent.trim() || null;

        file.versijosExists = Boolean(tds[5]?.querySelector("a"));

        failai.push(file);
    }

    return failai;
}

/**
 * Parses document versions list.
 * @param {string} htmlText
 * @returns {Promise<Array<object>>}
 */
export async function parseVersijos(htmlText) {
    const { document } = parseHTML(htmlText);
    const versijos = [];

    const versijosLentele = document.querySelector("#T02 > tbody");
    if (!versijosLentele) return versijos;

    const versijuRows = versijosLentele.querySelectorAll("tr");

    for (const row of versijuRows) {
        const tds = row.querySelectorAll("td");
        if (tds.length < 5) continue;

        const a = tds[2].querySelector("a");
        const versionIdMatch = a
            ?.getAttribute("href")
            ?.match(/versionId=(\d+)/);

        versijos.push({
            papildymoId:
                tds[0].textContent.trim() === "N/A"
                    ? null
                    : tds[0].textContent.trim(),
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
