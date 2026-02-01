import { parseHTML } from "linkedom";

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

function formatShortDate(dateStr) {
    // Converts dd/mm/yyyy → yyyy-mm-dd
    if (!dateStr) return null;
    const [d, m, y] = dateStr.trim().split("/");
    if (!d || !m || !y) return null;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// Format date "dd/mm/yyyy hh:mm" or "dd/mm/yyyy hh:mm:ss" → "yyyy-mm-dd hh:mm:ss" (seconds optional)
function formatDate(dateStr) {
    if (!dateStr) return null;
    const [datePart, timePart] = dateStr.trim().split(" ");
    const [d, m, y] = datePart.split("/");
    if (!d || !m || !y) return null;
    return timePart
        ? `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")} ${timePart}`
        : `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

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

        if (key === "pirkimoVykdytojoPavadinimas") {
            const a = dd.querySelector("a");
            if (a) {
                const href = a.getAttribute("href");
                const idMatch = href.match(/id=(\d+)/);
                result.pirkimoVykdytojasId = idMatch ? idMatch[1] : null;
                result.pirkimoVykdytojasPavadinimas = a.textContent.trim();
            }
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
            const n = Number(
                dd.textContent.replace(",", ".").replace(/\.$/, "").trim(),
            );
            result[key] = n > 0 ? n : null;
        } else if (key.startsWith("kategorijadalisPavadinimas")) {
            if (!result.kategorijaDalys) result.kategorijaDalys = [];
            result.kategorijaDalys.push(dd.textContent.trim());
        } else if (key.startsWith("daliuPavadinimas")) {
            if (!result.daliuPavadinimai) result.daliuPavadinimai = [];
            result.daliuPavadinimai.push(dd.textContent.trim());
        } else if (
            key === "susipazinimoSuPasiulymaisData" ||
            key === "paaiskinimuTerminoPabaiga" ||
            key === "pasiulymuArbaParaiskuDalyvautiPirkimePateikimoTerminas" ||
            key === "paskelbimoIrArbaKvietimoData" ||
            key === "laimetojoNustatymoData" ||
            key === "pasiulymuPateikimoTerminas" ||
            key === "kvsGaliojimoDataIrLaikas" ||
            key === "dpsGaliojimoDataIrLaikas"
        ) {
            result[key] = formatDate(dd.textContent);
        } else if (key === "pirkimuSuvestinesNuoroda") {
            result[key] = dd.textContent.trim();
        } else {
            result[key] = dd.textContent.trim();
        }

        if (
            key ===
            "pasiulymuVertinimoKriterijaiPasirinktasVertinimoKriterijusBusTaikomasVisomsPirkimoDalimskategorijoms"
        ) {
            result["pasiulymuVertinimoKriterijai"] = dd.textContent.trim();
            delete result[key];
        }
    }

    return result;
}

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

        if (key === "pirkimoVykdytojoPavadinimas") {
            const a = dd.querySelector("a");
            if (a) {
                const href = a.getAttribute("href");
                const idMatch = href.match(/id=(\d+)/);
                result.pirkimoVykdytojasId = idMatch ? idMatch[1] : null;
                result.pirkimoVykdytojasPavadinimas = a.textContent.trim();
            }
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
            const n = Number(
                dd.textContent.replace(",", ".").replace(/\.$/, "").trim(),
            );
            result[key] = n > 0 ? n : null;
        } else if (
            key === "susipazinimoSuPasiulymaisData" ||
            key === "paaiskinimuTerminoPabaiga" ||
            key === "pasiulymuArbaParaiskuDalyvautiPirkimePateikimoTerminas" ||
            key === "paskelbimoIrArbaKvietimoData" ||
            key === "laimetojoNustatymoData" ||
            key === "pasiulymuPateikimoTerminas"
        ) {
            result[key] = formatDate(dd.textContent);
        } else if (key === "pirkimuSuvestinesNuoroda") {
            result[key] = dd.textContent.trim();
        } else {
            result[key] = dd.textContent.trim();
        }

        if (
            key ===
            "pasiulymuVertinimoKriterijaiPasirinktasVertinimoKriterijusBusTaikomasVisomsPirkimoDalimskategorijoms"
        ) {
            result["pasiulymuVertinimoKriterijai"] = dd.textContent.trim();
            delete result[key];
        }
    }

    return result;
}

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

        if (key === "pirkimoVykdytojoPavadinimas") {
            const a = dd.querySelector("a");
            if (a) {
                const href = a.getAttribute("href");
                const idMatch = href.match(/id=(\d+)/);
                result.pirkimoVykdytojasId = idMatch ? idMatch[1] : null;
                result.pirkimoVykdytojasPavadinimas = a.textContent.trim();
            }
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
            const n = Number(
                dd.textContent.replace(",", ".").replace(/\.$/, "").trim(),
            );
            result[key] = n > 0 ? n : null;
        } else if (
            key === "susipazinimoSuPasiulymaisData" ||
            key === "paaiskinimuTerminoPabaiga" ||
            key === "pasiulymuArbaParaiskuDalyvautiPirkimePateikimoTerminas" ||
            key === "paskelbimoIrArbaKvietimoData" ||
            key === "laimetojoNustatymoData"
        ) {
            result[key] = formatDate(dd.textContent);
        } else if (key === "pirkimuSuvestinesNuoroda") {
            result[key] = dd.textContent.trim();
        } else {
            result[key] = dd.textContent.trim();
        }

        if (
            key ===
            "pasiulymuVertinimoKriterijaiPasirinktasVertinimoKriterijusBusTaikomasVisomsPirkimoDalimskategorijoms"
        ) {
            result["pasiulymuVertinimoKriterijai"] = dd.textContent.trim();
            delete result[key];
        }
    }

    return result;
}

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
