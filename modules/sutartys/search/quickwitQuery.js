import { foldLithuanian } from "../../../utils/text.js";
import { qwUserText } from "../../../quickwit/qwUserText.js";
import { sumaBaze } from "./sumaBaze.js";

export const QUICKWIT_LENTELE = "sutartys";
export const QUICKWIT_PAGE_SIZE = 50;
export const SUTARTYS_EXPORT_LIMIT = 100_000;
export const QUICKWIT_EXPORT_WINDOW = 5_000;

// Tekstinei paieškai skenuojami keli tekstiniai (tokenizuoti) laukai — ne vien
// `tekstas` (default_search_fields), kad sutaptų ir pavadinimas, tiekėjas ir kt.
const QUICKWIT_TEXT_FIELDS = [
    "pavadinimas",
    "tekstas",
    "tiekejai",
    "perkanciojiOrganizacija",
    "bvpzPavadinimai",
];

// Quickwit reikšmę, kurioje gali būti tarpų ar specialiųjų simbolių, saugu
// paduoti kabutėse (raw laukams — tiksli atitiktis).
function qwQuote(value) {
    return JSON.stringify(String(value));
}

export function qwDate(raw, endOfDay = false) {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return null;
    const day = d.toISOString().slice(0, 10);
    return `${day}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

/**
 * Pastato Quickwit užklausą iš sutarčių paieškos parametrų. Atspindi tuos
 * pačius filtrus kaip Postgres `sutartysFilter`.
 *
 * `exclude` leidžia praleisti konkretaus faceto filtrą, kad to faceto agregacija
 * rodytų visas reikšmes pagal KITUS aktyvius filtrus (kaip /dokumentai). Raktai
 * atitinka facetų parametrus: `tipas`, `kategorija`,
 * `perkanciosiosOrganizacijosKodas`, `tiekejoKodas`, `bvpz`.
 *
 * @param {object} query
 * @param {{ exclude?: string[] }} [opts]
 * @returns {string}
 */
export function buildSutartysQuickwitQuery(query, { exclude = [] } = {}) {
    const parts = [];
    const skip = (key) => exclude.includes(key);

    // Naudotojo tekstą sulietuvinam ir paverčiam saugiais terminais (žr.
    // qwUserText — kitaip `test:` ar `a{b` sugriautų Quickwit parserį).
    const terms = qwUserText(foldLithuanian(query.search ?? ""));
    if (terms) {
        parts.push(
            `(${QUICKWIT_TEXT_FIELDS.map((f) => `${f}:(${terms})`).join(" OR ")})`,
        );
    }

    // Daugiareikšmiai (multi-select) facetų filtrai: reikšmės atskirtos kableliu,
    // sujungiamos OR (bet kuri atitinka). Tuščia → praleidžiam.
    const orClause = (field, raw) => {
        const vals = String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        if (!vals.length) return null;
        return `(${vals.map((v) => `${field}:${qwQuote(v)}`).join(" OR ")})`;
    };

    if (!skip("perkanciosiosOrganizacijosKodas")) {
        const c = orClause("perkanciosiosOrganizacijosKodas", query.perkanciosiosOrganizacijosKodas);
        if (c) parts.push(c);
    }

    // tiekejoKodas atitinka bet kurį masyvo `tiekejaiKodai` elementą (pagr. + papildomi).
    if (!skip("tiekejoKodas")) {
        const c = orClause("tiekejaiKodai", query.tiekejoKodas);
        if (c) parts.push(c);
    }

    if (query.sutartiesNumeris)
        parts.push(`sutartiesNumeris:${qwQuote(query.sutartiesNumeris)}`);
    if (query.pirkimoNumeris)
        parts.push(`pirkimoNumeris:${qwQuote(query.pirkimoNumeris)}`);
    if (!skip("tipas")) {
        const c = orClause("tipas", query.tipas);
        if (c) parts.push(c);
    }
    if (!skip("kategorija")) {
        const c = orClause("kategorija", query.kategorija);
        if (c) parts.push(c);
    }

    if (query.sutartiesUnikalusID != null && query.sutartiesUnikalusID !== "") {
        const id = parseInt(query.sutartiesUnikalusID, 10);
        if (Number.isFinite(id)) parts.push(`sutartiesUnikalusId:${id}`);
    }

    if (!skip("sudarymoData")) {
        const nuo = query.sudarymoDataNuo && qwDate(query.sudarymoDataNuo);
        const iki = query.sudarymoDataIki && qwDate(query.sudarymoDataIki, true);
        if (nuo) parts.push(`sudarymoData:[${nuo} TO *]`);
        if (iki) parts.push(`sudarymoData:[* TO ${iki}]`);
    }

    const verteNuo = query.verteNuo != null && parseFloat(String(query.verteNuo).replace(",", "."));
    const verteIki = query.verteIki != null && parseFloat(String(query.verteIki).replace(",", "."));
    if (Number.isFinite(verteNuo)) parts.push(`verte:[${verteNuo} TO *]`);
    if (Number.isFinite(verteIki)) parts.push(`verte:[* TO ${verteIki}]`);

    if (!skip("suma")) {
        // Sumos laukas priklauso nuo „Suma laikyti" režimo (žr. sumaBaze.js).
        const sumaLaukas = sumaBaze(query).qw;
        const sumaNuo = query.sumaNuo != null && parseFloat(String(query.sumaNuo).replace(",", "."));
        const sumaIki = query.sumaIki != null && parseFloat(String(query.sumaIki).replace(",", "."));
        if (Number.isFinite(sumaNuo)) parts.push(`${sumaLaukas}:[${sumaNuo} TO *]`);
        if (Number.isFinite(sumaIki)) parts.push(`${sumaLaukas}:[* TO ${sumaIki}]`);
    }

    if (query.tikSuDokumentais !== undefined) parts.push(`dokumentuKiekis:>0`);
    if (query.ignoruotiSp !== undefined) parts.push(`NOT tipas:SP`);

    // BVPŽ kodo prefiksai (galima keli, atskirti tarpais) → prefiksinė atitiktis
    // (`bvpzKodai:4523*`, žr. Quickwit docs „Term Prefix") bet kuriam masyvo
    // `bvpzKodai` elementui. Reikšmė gali ateiti per `bvpzPrefiksas` (paslėptas)
    // arba `bvpzPrefiksasKitas` (matomas laukas / BVPŽ parinkiklis) — imam abu,
    // kaip ir Postgres `prefix_range` filtrai.
    if (!skip("bvpz")) {
        const bvpzPrefixes = [query.bvpzPrefiksas, query.bvpzPrefiksasKitas]
            .filter(Boolean)
            .flatMap((raw) => String(raw).split(" "))
            .map((p) => p.trim())
            .filter(Boolean);
        if (bvpzPrefixes.length)
            parts.push(`(${[...new Set(bvpzPrefixes)].map((p) => `bvpzKodai:${p}*`).join(" OR ")})`);
    }

    return parts.join(" AND ") || "*";
}

// Sutarčių Quickwit rikiavimas: bare laukas = mažėjančiai (naujausi/didžiausi),
// `-` prefiksas = didėjančiai — ta pati konvencija kaip dokumentų paieškoje.
export function quickwitSortBy(query) {
    const allowed = new Set([
        "paskutinioRedagavimoData",
        "sudarymoData",
        "verte",
        "paskelbimoData",
        "suma",
    ]);
    const raw = allowed.has(query.sort) ? query.sort : "paskutinioRedagavimoData";
    // Rikiavimas pagal sumą seka tą pačią vertės bazę kaip filtras.
    const col = raw === "suma" ? sumaBaze(query).qw : raw;
    const dir = ["asc", "desc"].includes((query.sortDir || "").toLowerCase())
        ? query.sortDir.toLowerCase()
        : "desc";
    return dir === "desc" ? col : `-${col}`;
}
