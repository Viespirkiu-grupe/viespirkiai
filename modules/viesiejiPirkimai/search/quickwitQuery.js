import { STATUSAS, PIRKIMO_BUDAS } from "../viesiejiPirkimaiEnums.js";
import { foldLithuanian } from "../../../utils/text.js";
import { qwUserText } from "../../../quickwit/qwUserText.js";

export const QUICKWIT_LENTELE = "viesiejiPirkimai";
export const QUICKWIT_PAGE_SIZE = 50;
const QUICKWIT_TEXT_FIELDS = [
    "pavadinimas",
    "tekstas",
    "pirkimoVykdytojas",
    "informacija",
];

function splitValues(val) {
    return String(val ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function qwQuote(value) {
    return JSON.stringify(String(value));
}

export function qwDate(raw, endOfDay = false) {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const day = d.toISOString().slice(0, 10);
    return `${day}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

function qwNumber(raw) {
    const number = parseFloat(String(raw).replace(",", "."));
    return Number.isFinite(number) ? number : null;
}

/**
 * Pastato Quickwit užklausą iš VP paieškos parametrų. Atspindi tuos pačius
 * filtrus kaip Postgres `viesiejiPirkimaiFilter`.
 *
 * `exclude` leidžia praleisti konkretaus faceto filtrą, kad to faceto agregacija
 * rodytų visas reikšmes pagal KITUS aktyvius filtrus (kaip /sutartys). Raktai:
 * `pirkimoVykdytojasId`, `pirkimoBudas`, `statusas`, `type`, `bvpz`, `verte`,
 * `paskelbimoData`.
 *
 * @param {object} query
 * @param {{ exclude?: string[] }} [opts]
 * @returns {string}
 */
export function buildViesiejiPirkimaiQuickwitQuery(query, { exclude = [] } = {}) {
    const parts = [];
    const skip = (key) => exclude.includes(key);

    // Naudotojo tekstas → saugūs Quickwit terminai (žr. qwUserText).
    const terms = qwUserText(foldLithuanian(query.search ?? ""));
    if (terms) {
        parts.push(
            `(${QUICKWIT_TEXT_FIELDS.map((field) => `${field}:(${terms})`).join(" OR ")})`,
        );
    }

    const orClause = (field, raw) => {
        const vals = splitValues(raw);
        if (!vals.length) return null;
        return `(${vals.map((value) => `${field}:${qwQuote(value)}`).join(" OR ")})`;
    };

    // Vykdytojo facetas ir tikslus kodas dalijasi `pvJarKodas` (jarKodas) parametru.
    if (!skip("pvJarKodas")) {
        const pvJarKodas = orClause("jarKodas", query.pvJarKodas);
        if (pvJarKodas) parts.push(pvJarKodas);
    }

    if (query.pirkimoId) parts.push(`pirkimoId:${qwQuote(query.pirkimoId)}`);

    // pirkimoBudas / statusas: URL'e enum raktai, Quickwit'e saugomi pavadinimai —
    // verčiam raktus į pavadinimus prieš užklausą (nežinomus praleidžiam).
    const ENUM_BY_FIELD = { pirkimoBudas: PIRKIMO_BUDAS, statusas: STATUSAS };
    const orClauseMapped = (field, raw) => {
        const enumMap = ENUM_BY_FIELD[field];
        const vals = splitValues(raw)
            .map((v) => (enumMap ? enumMap[v] : v))
            .filter(Boolean);
        if (!vals.length) return null;
        return `(${vals.map((v) => `${field}:${qwQuote(v)}`).join(" OR ")})`;
    };
    for (const field of ["pirkimoBudas", "statusas", "type"]) {
        if (skip(field)) continue;
        const clause = orClauseMapped(field, query[field]);
        if (clause) parts.push(clause);
    }
    // zingsnis facetu nerodomas, bet tiksliniu filtru paliekamas.
    {
        const clause = orClause("zingsnis", query.zingsnis);
        if (clause) parts.push(clause);
    }

    if (!skip("paskelbimoData")) {
        const paskelbimoNuo = query.paskelbimoDataNuo && qwDate(query.paskelbimoDataNuo);
        const paskelbimoIki = query.paskelbimoDataIki && qwDate(query.paskelbimoDataIki, true);
        if (paskelbimoNuo) parts.push(`paskelbimoData:[${paskelbimoNuo} TO *]`);
        if (paskelbimoIki) parts.push(`paskelbimoData:[* TO ${paskelbimoIki}]`);
    }

    const pasiulymuNuo = query.pasiulymuTerminasNuo && qwDate(query.pasiulymuTerminasNuo);
    const pasiulymuIki = query.pasiulymuTerminasIki && qwDate(query.pasiulymuTerminasIki, true);
    if (pasiulymuNuo) parts.push(`pasiulymuPateikimoTerminas:[${pasiulymuNuo} TO *]`);
    if (pasiulymuIki) parts.push(`pasiulymuPateikimoTerminas:[* TO ${pasiulymuIki}]`);

    if (!skip("verte")) {
        const verteNuo = query.verteNuo != null ? qwNumber(query.verteNuo) : null;
        const verteIki = query.verteIki != null ? qwNumber(query.verteIki) : null;
        if (verteNuo != null) parts.push(`numatomaBendraPirkimoVerte:[${verteNuo} TO *]`);
        if (verteIki != null) parts.push(`numatomaBendraPirkimoVerte:[* TO ${verteIki}]`);
    }

    if (!skip("bvpz")) {
        const bvpzPrefixes = String(query.bvpzPrefiksai ?? "")
            .split(/[\s,;]+/)
            .map((prefix) => prefix.trim())
            .filter(Boolean);
        if (bvpzPrefixes.length) {
            parts.push(`(${[...new Set(bvpzPrefixes)].map((prefix) => `bvpzKodai:${prefix}*`).join(" OR ")})`);
        }
    }

    return parts.join(" AND ") || "*";
}

export function quickwitSortBy(query) {
    const allowed = new Set([
        "paskelbimoData",
        "pasiulymuPateikimoTerminas",
        "numatomaBendraPirkimoVerte",
    ]);
    const col = allowed.has(query.sort) ? query.sort : "paskelbimoData";
    const dir = ["asc", "desc"].includes((query.sortDir || "").toLowerCase())
        ? query.sortDir.toLowerCase()
        : "desc";
    return dir === "desc" ? col : `-${col}`;
}

