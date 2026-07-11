import { postgres } from "../../postgres/postgres.js";
import { search as quickwitSearch, countDocs as quickwitCountDocs } from "../../quickwit/quickwit.js";
import { FilterBuilder } from "../../utils/filter.js";
import { fixHtmlEntities } from "../../utils/fixHtmlEntities.js";
import { Transform } from "node:stream";
import QueryStream from "pg-query-stream";
import { STATUSAS, PIRKIMO_BUDAS } from "./viesiejiPirkimaiEnums.js";
import { specialJarCodes } from "../juridiniai/specialJarCodes.js";
import { searchJar } from "../juridiniai/search.js";
import config from "../../utils/config.js";

const splitCsv = (val) => String(val ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// Daugiareikšmis (multi-select) filtras neapdorotoms (raw) reikšmėms: kableliu
// atskirtos reikšmės → OR. Naudojam facetų laukams (type, pvJarKodas/jarKodas).
const pgMultiEq = (col) => (addParam, val) => {
    const vals = splitCsv(val);
    if (!vals.length) return null;
    return `(${vals.map((v) => `${col} = ${addParam(v)}`).join(" OR ")})`;
};

// Kaip pgMultiEq, bet URL'e ateina enum RAKTAI (pvz. „atviras"); DB saugo
// pavadinimą (pvz. „Atviras konkursas"), tad raktus žemėlapiu paverčiam į
// saugomas reikšmes prieš lyginant. Nežinomus raktus praleidžiam.
const pgEnumMultiEq = (col, enumMap) => (addParam, val) => {
    const vals = splitCsv(val).map((k) => enumMap[k]).filter(Boolean);
    if (!vals.length) return null;
    return `(${vals.map((v) => `${col} = ${addParam(v)}`).join(" OR ")})`;
};

const viesiejiPirkimaiFilter = new FilterBuilder({
    fields: [
        // Vykdytojo facetas + tikslus kodas dalijasi `pvJarKodas` parametru
        // (registro `jarKodas`) — daugiareikšmis, kad veiktų ir facetų atranka.
        {
            key: "pvJarKodas",
            col: `"jarKodas"`,
            hidden: true,
            pgOverride: pgMultiEq(`"jarKodas"`),
        },
        {
            key: "pirkimoId",
            hidden: true,
        },
        // pirkimoBudas / statusas: URL'e enum raktai, DB — pavadinimai. Daugiareikšmiai
        // (facetai) — todėl vietoj `enum` naudojam raktus→pavadinimus verčiantį override.
        {
            key: "pirkimoBudas",
            hidden: true,
            pgOverride: pgEnumMultiEq(`"pirkimoBudas"`, PIRKIMO_BUDAS),
        },
        {
            key: "statusas",
            hidden: true,
            pgOverride: pgEnumMultiEq(`"statusas"`, STATUSAS),
        },
        {
            key: "zingsnis",
            hidden: true,
        },
        {
            key: "type",
            hidden: true,
            pgOverride: pgMultiEq(`"type"`),
        },
        {
            key: "paskelbimoDataNuo",
            col: `"paskelbimoData"`,
            type: "gte_date",
            hidden: true,
        },
        {
            key: "paskelbimoDataIki",
            col: `"paskelbimoData"`,
            type: "lte_date",
            hidden: true,
        },
        {
            key: "pasiulymuTerminasNuo",
            col: `"pasiulymuPateikimoTerminas"`,
            type: "gte_date",
            hidden: true,
        },
        {
            key: "pasiulymuTerminasIki",
            col: `"pasiulymuPateikimoTerminas"`,
            type: "lte_date",
            hidden: true,
        },
        {
            key: "verteNuo",
            col: `"numatomaBendraPirkimoVerte"`,
            type: "gte_number",
            hidden: true,
        },
        {
            key: "verteIki",
            col: `"numatomaBendraPirkimoVerte"`,
            type: "lte_number",
            hidden: true,
        },
        {
            key: "search",
            col: `"searchTsv"`,
            type: "tsvector",
            pgOnly: true,
        },
        {
            key: "bvpzPrefiksai",
            hidden: true,
            pgOverride: (addParam, val) => {
                const ors = val
                    .split(/[\s,;]+/)
                    .map((p) => p.trim())
                    .filter(Boolean)
                    .map((prefix) => {
                        const end = String(parseInt(prefix, 10) + 1).padStart(
                            prefix.length,
                            "0",
                        );
                        return `(code >= ${addParam(prefix.padEnd(8, "0"))} AND code < ${addParam(end.padEnd(8, "0"))})`;
                    });
                if (!ors.length) return null;
                return `"bvpzKodai" && ARRAY(SELECT code FROM "bvpzKodai" WHERE ${ors.join(" OR ")})`;
            },
        },
    ],
    sort: {
        default: "paskelbimoData",
        defaultDir: "desc",
        allowed: [
            "paskelbimoData",
            "pasiulymuPateikimoTerminas",
            "numatomaBendraPirkimoVerte",
        ],
    },
});

const FIXED_WHERE = [];
const QUICKWIT_LENTELE = "viesiejiPirkimai";
const QUICKWIT_PAGE_SIZE = 50;
const QUICKWIT_TEXT_FIELDS = [
    "pavadinimas",
    "tekstas",
    "pirkimoVykdytojas",
    "informacija",
];

function splitValues(val) {
    return String(val ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function foldLithuanian(str) {
    return str.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
}

function qwQuote(value) {
    return JSON.stringify(String(value));
}

function qwDate(raw, endOfDay = false) {
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

    const rawSearch = (query.search ?? "").trim();
    if (rawSearch && rawSearch !== "*") {
        const folded = foldLithuanian(rawSearch.replace(/"/g, "")).replace(/\\/g, "\\\\");
        parts.push(
            `(${QUICKWIT_TEXT_FIELDS.map((field) => `${field}:(${folded})`).join(" OR ")})`,
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

function quickwitSortBy(query) {
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

// ── Facetai (Quickwit agregacijos) ───────────────────────────────────────────
// Kaip /sutartys: kiekvienas facetas — term agregacija, apskaičiuota pagal
// užklausą, iš kurios pašalintas TO PATIES faceto filtras, kad matytųsi visos
// reikšmės po kitų filtrų. Kodinis facetas (vykdytojas) papildomas JAR
// pavadinimais; enum facetai (pirkimo būdas/statusas) — žmogui skirtais.

const QW_URL = config.quickwitUrl ?? config.quickwitHost ?? "http://localhost:7280";

/** Viena Quickwit term agregacija. Grąžina [{ value, count }]. */
async function qwFacet(field, query, size) {
    try {
        const res = await fetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query,
                max_hits: 0,
                aggs: { values: { terms: { field, size } } },
                format: "json",
            }),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data?.aggregations?.values?.buckets ?? []).map((b) => ({
            value: String(b.key),
            count: Number(b.doc_count),
        }));
    } catch {
        return [];
    }
}

// Vertės pasiskirstymo (histogramos) log-skalės kraštinės (€): ~5 žingsniai
// dekadai (1,2,3,5,7) nuo 10 iki 100 mln. Paskutinis kaušas — „nuo 100 mln."
const VERTE_EDGES = (() => {
    const edges = [0];
    for (let d = 1; d <= 8; d++) {
        for (const m of [1, 2, 3, 5, 7]) {
            const v = m * 10 ** d;
            if (v <= 100_000_000) edges.push(v);
        }
    }
    return edges;
})();

/**
 * Numatomos vertės pasiskirstymas log kaušais pagal esamą užklausą, iš kurios
 * pašalintas pats vertės filtras (facet-exclude). Domenas dinamiškas: nukerpami
 * tušti kaušai galuose. Kaip `sutartysSumaHistogram`.
 * @param {object} query
 * @returns {Promise<{ buckets: { from: number, to: number|null, count: number }[], domainMin: number, domainMax: number }>}
 */
export async function viesiejiPirkimaiVerteHistogram(query) {
    const edgeMax = VERTE_EDGES[VERTE_EDGES.length - 1];
    const fallback = { buckets: [], domainMin: 0, domainMax: edgeMax };
    const ranges = VERTE_EDGES.slice(0, -1).map((from, i) => ({ from, to: VERTE_EDGES[i + 1] }));
    ranges.push({ from: edgeMax });

    const qwQuery = buildViesiejiPirkimaiQuickwitQuery(query, { exclude: ["verte"] });
    try {
        const res = await fetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: qwQuery,
                max_hits: 0,
                aggs: { verte: { range: { field: "numatomaBendraPirkimoVerte", ranges } } },
                format: "json",
            }),
        });
        if (!res.ok) return fallback;
        const data = await res.json();
        const all = (data?.aggregations?.verte?.buckets ?? [])
            .map((b) => ({
                from: Number(b.from ?? 0),
                to: b.to != null ? Number(b.to) : null,
                count: Number(b.doc_count),
            }))
            .filter((b) => b.to === null || b.to > b.from);
        if (!all.length) return fallback;

        const total = all.reduce((s, b) => s + b.count, 0);
        if (!total) return fallback;
        const lowCut = total * 0.01;
        const highCut = total * 0.99;
        let start = 0;
        let end = all.length - 1;
        let cum = 0;
        for (let i = 0; i < all.length; i++) {
            cum += all[i].count;
            if (cum > lowCut) { start = i; break; }
        }
        cum = 0;
        for (let i = 0; i < all.length; i++) {
            cum += all[i].count;
            if (cum >= highCut) { end = i; break; }
        }
        if (end < start) end = start;

        const MIN_BARS = 10;
        while (end - start + 1 < MIN_BARS && (start > 0 || end < all.length - 1)) {
            if (start > 0) start--;
            if (end - start + 1 < MIN_BARS && end < all.length - 1) end++;
        }

        const buckets = all.slice(start, end + 1);
        return {
            buckets,
            domainMin: buckets[0].from,
            domainMax: buckets[buckets.length - 1].to ?? edgeMax,
        };
    } catch {
        return fallback;
    }
}

// Laikotarpio histogramos bazinis intervalas (~mėnuo) ir sveiko proto rėžiai.
const DATA_INTERVAL = "30d";
const DATA_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
const DATA_BOUND_MIN = "2013-01-01";
const dataBoundMax = () => `${new Date().getUTCFullYear() + 1}-01-01`;

/**
 * Paskelbimo datų pasiskirstymas pagal esamą užklausą (facet-exclude „paskelbimoData").
 * Quickwit `date_histogram`, nukerpa tuščius galus, adaptyviai sujungia kaušus.
 * Kaip `sutartysDataHistogram`.
 * @param {object} query
 * @returns {Promise<{ buckets: { from: number, to: number|null, count: number }[], domainMin: number, domainMax: number }>}
 */
export async function viesiejiPirkimaiLaikotarpisHistogram(query) {
    const boundMin = qwDate(DATA_BOUND_MIN);
    const boundMax = qwDate(dataBoundMax());
    const fallback = { buckets: [], domainMin: Date.parse(DATA_BOUND_MIN), domainMax: Date.parse(dataBoundMax()) };
    const qwQuery = [
        buildViesiejiPirkimaiQuickwitQuery(query, { exclude: ["paskelbimoData"] }),
        `paskelbimoData:[${boundMin} TO ${boundMax}]`,
    ].join(" AND ");
    try {
        const res = await fetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: qwQuery,
                max_hits: 0,
                aggs: { data: { date_histogram: { field: "paskelbimoData", fixed_interval: DATA_INTERVAL } } },
                format: "json",
            }),
        });
        if (!res.ok) return fallback;
        const data = await res.json();
        let all = (data?.aggregations?.data?.buckets ?? []).map((b) => ({
            from: Number(b.key),
            to: Number(b.key) + DATA_INTERVAL_MS,
            count: Number(b.doc_count),
        }));
        if (!all.length) return fallback;

        let start = 0;
        while (start < all.length && all[start].count === 0) start++;
        let end = all.length - 1;
        while (end > start && all[end].count === 0) end--;
        if (start > end) return fallback;
        all = all.slice(start, end + 1);

        const TARGET = 36;
        let group = 1;
        for (const g of [1, 3, 6, 12, 24, 60]) {
            group = g;
            if (Math.ceil(all.length / g) <= TARGET) break;
        }
        const buckets = [];
        for (let i = 0; i < all.length; i += group) {
            const chunk = all.slice(i, i + group);
            buckets.push({
                from: chunk[0].from,
                to: chunk[chunk.length - 1].to,
                count: chunk.reduce((s, b) => s + b.count, 0),
            });
        }
        return {
            buckets,
            domainMin: buckets[0].from,
            domainMax: buckets[buckets.length - 1].to,
        };
    } catch {
        return fallback;
    }
}

/** Papildo kodinį vykdytojo facetą JAR pavadinimais. Nerasti kodai lieka be label. */
async function attachJarNames(options) {
    const codes = [...new Set(options.map((o) => o.value).filter(Boolean))];
    if (!codes.length) return options;
    const { rows } = await postgres.query(
        `SELECT "jarKodas", pavadinimas FROM public.jar WHERE "jarKodas" = ANY($1)`,
        [codes],
    );
    const names = new Map(
        rows.filter((r) => r.pavadinimas).map((r) => [String(r.jarKodas), String(r.pavadinimas)]),
    );
    return options.map((o) => ({
        ...o,
        label: names.get(o.value) ?? specialJarCodes[o.value]?.pavadinimas,
    }));
}

/** Papildo BVPŽ facetus pavadinimais; kodus sutraukia iki 8 skaitmenų. */
async function attachBvpzNames(options) {
    const byCode = new Map();
    for (const o of options) {
        const code = o.value.split("-")[0];
        byCode.set(code, (byCode.get(code) ?? 0) + (o.count ?? 0));
    }
    const codes = [...byCode.keys()];
    if (!codes.length) return [];
    const { rows } = await postgres.query(
        `SELECT code, pavadinimas FROM public."bvpzKodai" WHERE code = ANY($1)`,
        [codes],
    );
    const names = new Map(rows.map((r) => [String(r.code), String(r.pavadinimas)]));
    return codes.map((code) => ({ value: code, label: names.get(code), count: byCode.get(code) }));
}

/** Pažymėtus BVPŽ prefiksus išrenka iš užklausos. */
function selectedBvpzPrefixes(query) {
    return [...new Set(
        String(query.bvpzPrefiksai ?? "")
            .split(/[\s,;]+/)
            .map((p) => p.trim())
            .filter(Boolean),
    )];
}

/** Pažymėtiems BVPŽ prefiksams priskiria prefiksinės atitikties pirkimų skaičių
 *  pagal kitus filtrus (facet-exclude), kad nepilni kodai rodytųsi su „*" ženklu
 *  ir skaičiumi. Pavadinimo nerodom — vien kodas su „*". */
async function attachSelectedBvpz(prefixes, query) {
    const uniq = [...new Set(prefixes)].filter(Boolean);
    if (!uniq.length) return [];
    const base = buildViesiejiPirkimaiQuickwitQuery(query, { exclude: ["bvpz"] });
    const counts = await Promise.all(
        uniq.map((p) =>
            quickwitCountDocs(QUICKWIT_LENTELE, {
                query: base === "*" ? `bvpzKodai:${p}*` : `(${base}) AND bvpzKodai:${p}*`,
            }).catch(() => null),
        ),
    );
    return uniq.map((value, i) => ({
        value,
        count: counts[i],
        isPrefix: value.replace(/\D/g, "").length < 8,
    }));
}

// Enum facetui (pirkimoBudas/statusas): agregacija grąžina saugomą pavadinimą;
// atvaizduojam kaip { value: raktas, label: pavadinimas }, kad URL'e keliautų
// raktas (suderinama su tiksliniu filtru ir MCP). Nežinomus pavadinimus praleidžiam.
function mapEnumFacet(buckets, enumMap) {
    const labelToKey = new Map(Object.entries(enumMap).map(([k, v]) => [v, k]));
    return buckets
        .map((b) => {
            const key = labelToKey.get(b.value);
            return key ? { value: key, label: b.value, count: b.count } : null;
        })
        .filter(Boolean);
}

/**
 * Suskaičiuoja visus VP šoninės juostos facetus vienai užklausai (facet-exclude
 * kiekvienam). Grąžina map'ą facetų pavadinimas → [{ value, label?, count }].
 * @param {object} query
 * @returns {Promise<object>}
 */
export async function viesiejiPirkimaiFacets(query) {
    const q = (excl) => buildViesiejiPirkimaiQuickwitQuery(query, { exclude: excl });
    const selVykdytojai = splitCsv(query.pvJarKodas);

    const [vykdytojaiRaw, pirkimoBudasRaw, statusasRaw, bvpz, verte, laikotarpis] =
        await Promise.all([
            // Vykdytojas — agreguojam pagal registro kodą (jarKodas), kad turėtume
            // pavadinimus (pirkimoVykdytojasId yra vidinis CVP IS ID, ne kodas).
            qwFacet("jarKodas", q(["pvJarKodas"]), 8),
            qwFacet("pirkimoBudas", q(["pirkimoBudas"]), 15),
            qwFacet("statusas", q(["statusas"]), 12),
            qwFacet("bvpzKodai", q(["bvpz"]), 10),
            viesiejiPirkimaiVerteHistogram(query),
            viesiejiPirkimaiLaikotarpisHistogram(query),
        ]);

    const [vykdytojaiNamed, bvpzNamed, bvpzSelected] = await Promise.all([
        attachJarNames(vykdytojaiRaw.filter((b) => b.value)),
        attachBvpzNames(bvpz.filter((b) => b.value)),
        attachSelectedBvpz(selectedBvpzPrefixes(query), query),
    ]);

    // Pasirinktus BVPŽ prefiksus (nepilnus kodus), kurių nėra tarp dažniausių,
    // pridedam priekyje su pavadinimu + prefiksinės atitikties skaičiumi.
    const bvpzPresent = new Set(bvpzNamed.map((o) => o.value));
    const bvpzFinal = [...bvpzSelected.filter((o) => !bvpzPresent.has(o.value)), ...bvpzNamed];

    // Pasirinktus (įsk. „custom" įvestus) kodus, kurių nėra tarp dažniausių,
    // pridedam priekyje su JAR pavadinimu.
    const present = new Set(vykdytojaiNamed.map((o) => o.value));
    const missing = selVykdytojai.filter((v) => !present.has(v));
    const vykdytojaiFinal = missing.length
        ? [...(await attachJarNames(missing.map((v) => ({ value: v, count: null })))), ...vykdytojaiNamed]
        : vykdytojaiNamed;

    return {
        vykdytojai: vykdytojaiFinal,
        pirkimoBudas: mapEnumFacet(pirkimoBudasRaw.filter((b) => b.value), PIRKIMO_BUDAS),
        statusas: mapEnumFacet(statusasRaw.filter((b) => b.value), STATUSAS),
        bvpz: bvpzFinal,
        verte,
        laikotarpis,
    };
}

// Facetų laukas → „iš užklausos pašalinamo" filtro raktas (facet-exclude), kad
// „Daugiau" dialogo sąrašas rodytų visas reikšmes pagal kitus filtrus.
const FACET_FIELD_EXCLUDE = {
    jarKodas: "pvJarKodas",
    bvpzKodai: "bvpz",
};

/**
 * Pilnas vieno facetų lauko reikšmių sąrašas pagal esamą užklausą/filtrus —
 * maitina „Daugiau" dialogą. `optionSearch` leidžia ieškoti registre (kodu ar
 * pavadinimu) reikšmių, kurių gali nebūti tarp dažniausių.
 * @param {'jarKodas'|'bvpzKodai'} field
 * @param {object} query
 * @param {number} [size=1000]
 * @param {string} [optionSearch='']
 * @returns {Promise<{ value: string, label?: string, count: number|null }[]>}
 */
export async function viesiejiPirkimaiFacetOptions(field, query, size = 1000, optionSearch = "") {
    const excludeKey = FACET_FIELD_EXCLUDE[field];
    if (!excludeKey) return [];

    const qwQuery = buildViesiejiPirkimaiQuickwitQuery(query, { exclude: [excludeKey] });
    const buckets = (await qwFacet(field, qwQuery, size)).filter((b) => b.value);

    if (field === "bvpzKodai") {
        const options = await attachBvpzNames(buckets);
        if (!optionSearch) {
            const present = new Set(options.map((o) => o.value));
            const selected = await attachSelectedBvpz(
                selectedBvpzPrefixes(query).filter((v) => !present.has(v)),
                query,
            );
            return [...selected, ...options];
        }
        const needle = optionSearch.toLowerCase();
        const inline = options.filter(
            (o) => o.value.includes(optionSearch) || (o.label?.toLowerCase().includes(needle) ?? false),
        );
        if (inline.length) return inline;
        const counts = new Map(options.map((o) => [o.value, o.count]));
        const rows = /^\d+$/.test(optionSearch)
            ? (
                  await postgres.query(
                      `SELECT code, pavadinimas FROM public."bvpzKodai" WHERE code LIKE $1 ORDER BY code LIMIT 50`,
                      [`${optionSearch}%`],
                  )
              ).rows
            : (
                  await postgres.query(
                      `SELECT code, pavadinimas FROM public."bvpzKodai" WHERE pavadinimas ILIKE $1 ORDER BY code LIMIT 50`,
                      [`%${optionSearch}%`],
                  )
              ).rows;
        return rows.map((r) => ({
            value: String(r.code),
            label: r.pavadinimas ? String(r.pavadinimas) : undefined,
            count: counts.get(String(r.code)) ?? null,
        }));
    }

    const options = await attachJarNames(buckets);
    if (!optionSearch) return options;

    // Pirmiausia — facetuoti pasirinkimai (su skaičiais pagal esamą užklausą),
    // atitinkantys paiešką. Tik jei tokių nėra, krentam į registro paiešką.
    const needle = optionSearch.toLowerCase();
    const inline = options.filter(
        (o) => o.value.includes(optionSearch) || (o.label?.toLowerCase().includes(needle) ?? false),
    );
    if (inline.length) return inline;

    const counts = new Map(options.map((o) => [o.value, o.count]));
    const registryRows = /^\d+$/.test(optionSearch)
        ? (
              await postgres.query(
                  `SELECT "jarKodas", pavadinimas FROM public.jar WHERE "jarKodas" LIKE $1 ORDER BY "jarKodas" LIMIT 50`,
                  [`${optionSearch}%`],
              )
          ).rows
        : (await searchJar({ search: optionSearch }, { page: 1, limit: 50 })).results;

    return registryRows
        .filter((r) => r.jarKodas)
        .map((r) => ({
            value: String(r.jarKodas),
            label: r.pavadinimas
                ? String(r.pavadinimas)
                : specialJarCodes[String(r.jarKodas)]?.pavadinimas,
            count: counts.get(String(r.jarKodas)) ?? null,
        }));
}

async function loadQuickwitRowsFromPostgres(hits) {
    const ids = hits.map((hit) => String(hit.pirkimoId)).filter(Boolean);
    if (!ids.length) return [];

    const { rows } = await postgres.query(
        `SELECT *
         FROM public."viesiejiPirkimai"
         WHERE "pirkimoId" = ANY($1::text[])`,
        [ids],
    );
    const rowsById = new Map(rows.map((row) => [String(row.pirkimoId), row]));
    return ids.map((id) => rowsById.get(id)).filter(Boolean);
}

/**
 * @typedef {object} SearchOptions
 * @property {number} limit - Rows per page.
 * @property {number} [page=1] - Current page number.
 * @property {"postgres" | "quickwit"} [engine="postgres"] - Search engine to use.
 * @property {boolean} [stream=false] - Return a raw stream instead of rows.
 */

/**
 * @typedef {object} SearchResult
 * @property {object[]} results
 * @property {number | null} total
 * @property {object} values
 * @property {string} queryParams
 * @property {import("pg-query-stream") | null} stream
 * @property {import("pg").PoolClient | null} client
 */

/**
 * Searches the viesiejiPirkimai table using Postgres.
 * @param {object} query - Express request query object.
 * @param {SearchOptions} options
 * @returns {Promise<SearchResult>}
 */
export async function searchViesiejiPirkimai(
    query,
    { limit, page = 1, engine = "postgres", stream = false, sort = true, includeFacets = false } = {},
) {
    const searchStarted = performance.now();

    if (engine === "quickwit" && !stream) {
        const { values, queryParams } = viesiejiPirkimaiFilter.build(query);
        const qwQuery = buildViesiejiPirkimaiQuickwitQuery(query);
        const effLimit = limit ?? QUICKWIT_PAGE_SIZE;

        const quickwitStarted = performance.now();
        // Pagrindinė paieška ir facetų agregacijos vyksta lygiagrečiai.
        const [result, facets] = await Promise.all([
            quickwitSearch(
                QUICKWIT_LENTELE,
                { query: qwQuery, sort_by: sort ? quickwitSortBy(query) : undefined },
                { minHits: page * effLimit },
            ),
            includeFacets ? viesiejiPirkimaiFacets(query) : Promise.resolve(null),
        ]);
        const quickwitEnded = performance.now();

        const pageHits = result.hits.slice((page - 1) * effLimit, page * effLimit);

        const postgresStarted = performance.now();
        const rows = await loadQuickwitRowsFromPostgres(pageHits);
        const postgresEnded = performance.now();

        return {
            results: rows.map(aptvarkytiRezultata),
            total: result.numHitsEstimate ?? result.hits.length,
            values,
            queryParams,
            facets,
            timings: [
                {
                    label: "Quickwit",
                    phase: "search",
                    start: Math.round(quickwitStarted - searchStarted),
                    duration: Math.round(quickwitEnded - quickwitStarted),
                },
                {
                    label: "PostgreSQL",
                    phase: "pg",
                    start: Math.round(postgresStarted - searchStarted),
                    duration: Math.round(postgresEnded - postgresStarted),
                },
            ],
            stream: null,
            client: null,
        };
    }

    const { sql, params, values, queryParams } =
        viesiejiPirkimaiFilter.build(query, {
            table: `"viesiejiPirkimai"`,
            fixedWhere: FIXED_WHERE,
            limit,
            page,
            sort,
        });

    if (stream) {
        const client = await postgres.connect();
        return {
            results: [],
            total: null,
            values,
            queryParams,
            stream: client.query(new QueryStream(sql, params)).pipe(
                new Transform({
                    objectMode: true,
                    transform(row, _enc, cb) {
                        cb(null, aptvarkytiRezultata(row));
                    },
                }),
            ),
            client,
        };
    }

    const { rows } = await postgres.query(sql, params);
    return {
        results: rows.map(aptvarkytiRezultata),
        total: null,
        values,
        queryParams,
        timings: [
            {
                label: "PostgreSQL",
                phase: "pg",
                start: 0,
                duration: Math.round(performance.now() - searchStarted),
            },
        ],
        stream: null,
        client: null,
    };
}

/**
 * Returns a precise COUNT of viesiejiPirkimai rows matching the given query.
 * @param {object} query - Express request query object.
 * @returns {Promise<number>}
 */
export async function countViesiejiPirkimai(query) {
    const { sqlCount, params, visiIrasai } = viesiejiPirkimaiFilter.build(
        query,
        {
            table: `"viesiejiPirkimai"`,
            fixedWhere: FIXED_WHERE,
        },
    );

    if (visiIrasai) {
        const { rows } = await postgres.query(
            `SELECT "rowCount" FROM "eiluciuSkaiciai" WHERE "tableName" = 'viesiejiPirkimai'`,
        );
        if (rows[0] && rows[0].rowCount) {
            return Number(rows[0].rowCount);
        }
    }

    const { rows } = await postgres.query(sqlCount, params);
    return parseInt(rows[0].count, 10);
}

/**
 * Normalises a single row from the DB.
 * @param {object} r
 * @returns {object}
 */
export function aptvarkytiRezultata(r) {
    r.pavadinimas = fixHtmlEntities(r.pavadinimas ?? "");
    r.pirkimoVykdytojas = fixHtmlEntities(r.pirkimoVykdytojas ?? "");
    r.informacija = fixHtmlEntities(r.informacija ?? "");

    return r;
}
