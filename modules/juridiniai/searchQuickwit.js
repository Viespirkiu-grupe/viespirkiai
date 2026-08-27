import { search as quickwitSearch } from "../../quickwit/quickwit.js";
import { searchIndexPattern } from "../../quickwit/qwHttp.js";
import { qwUserText } from "../../quickwit/qwUserText.js";
import { foldLithuanian } from "../../utils/text.js";
import { postgres } from "../../postgres/postgres.js";

const LENTELE = "juridiniai";
const INDEX_PATTERN = `${LENTELE}_*`;
const TEXT_FIELDS = ["pavadinimas", "pavadinimasAscii", "adresas", "evrkPavadinimas", "jarKodas"];
const splitCsv = (value) => String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const quote = (value) => JSON.stringify(String(value));

function dateValue(raw, endOfDay = false) {
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return null;
    return `${raw}T${endOfDay ? "23:59:59" : "00:00:00"}Z`;
}

function numberValue(raw) {
    if (raw == null || raw === "") return null;
    const value = Number(String(raw).replace(",", "."));
    return Number.isFinite(value) ? value : null;
}

function orTerms(field, raw) {
    const values = splitCsv(raw);
    return values.length ? `(${values.map((value) => `${field}:${quote(value)}`).join(" OR ")})` : null;
}

export function buildJuridiniaiQuickwitQuery(query = {}, { exclude = [] } = {}) {
    const parts = [];
    const skip = (key) => exclude.includes(key);
    const search = qwUserText(foldLithuanian(query.search ?? ""));
    if (search) parts.push(`(${TEXT_FIELDS.map((field) => `${field}:(${search})`).join(" OR ")})`);

    if (query.jarKodas) parts.push(`jarKodas:${quote(query.jarKodas)}`);
    for (const [key, field] of [
        ["forma", "formosPavadinimas"],
        ["statusas", "statusoPavadinimas"],
        ["apskritis", "apskritis"],
        ["savivaldybe", "savivaldybe"],
        ["evrk", "evrkKodas"],
    ]) {
        if (!skip(key)) {
            const clause = orTerms(field, query[key]);
            if (clause) parts.push(clause);
        }
    }

    if (!skip("registracija") && query.registracija === "registruoti") parts.push("isregistruotas:false");
    if (!skip("registracija") && query.registracija === "isregistruoti") parts.push("isregistruotas:true");

    const registeredFrom = dateValue(query.registravimoDataNuo);
    const registeredTo = dateValue(query.registravimoDataIki, true);
    if (!skip("registravimoData")) {
        if (registeredFrom) parts.push(`registravimoData:[${registeredFrom} TO *]`);
        if (registeredTo) parts.push(`registravimoData:[* TO ${registeredTo}]`);
    }

    for (const [key, field] of [["darbuotojai", "darbuotojai"], ["atlyginimas", "vidutinisAtlyginimas"]]) {
        if (skip(key)) continue;
        const from = numberValue(query[`${key}Nuo`]);
        const to = numberValue(query[`${key}Iki`]);
        if (from != null) parts.push(`${field}:[${from} TO *]`);
        if (to != null) parts.push(`${field}:[* TO ${to}]`);
    }

    const tileZoom = Number(query.tileZoom);
    const tileKey = Number(query.tileKey);
    if (Number.isInteger(tileZoom) && tileZoom >= 0 && tileZoom <= 19 && Number.isSafeInteger(tileKey)) {
        parts.push(`geo.z${tileZoom}:${tileKey}`);
    }

    return parts.join(" AND ") || "*";
}

// Antrinis rikiavimo laukas, kad vienodų reikšmių eilutės nešokinėtų tarp
// puslapių. Quickwit nerikiuoja pagal `text` laukus, todėl jarKodas skaičius
// papildomai indeksuojamas į `rodikliai.jarKodas` (žr. quickwitProcessIndexQueue.js).
const TIE_BREAKER = "rodikliai.jarKodas";

function sortBy(query) {
    const allowed = new Set(["atnaujinta", "registravimoData", "darbuotojai", "vidutinisAtlyginimas"]);
    const field = allowed.has(query.sort) ? query.sort : "darbuotojai";
    // Be minuso Quickwit rikiuoja mažėjančiai, su minusu – didėjančiai.
    return `${query.sortDir === "asc" ? `-${field}` : field},${TIE_BREAKER}`;
}

async function aggregate(query, aggs) {
    return searchIndexPattern(INDEX_PATTERN, { query, max_hits: 0, aggs, format: "json" });
}

async function termFacet(field, query, size = 12) {
    try {
        const data = await aggregate(query, { values: { terms: { field, size } } });
        return (data?.aggregations?.values?.buckets ?? []).map((bucket) => ({
            value: String(bucket.key_as_string ?? bucket.key),
            count: Number(bucket.doc_count),
        })).filter((option) => option.value);
    } catch {
        return [];
    }
}

let evrkNamesPromise;
async function evrkNames() {
    if (!evrkNamesPromise) {
        evrkNamesPromise = postgres.query(
            `SELECT "kodas", "pavadinimas" FROM public."juridiniaiEvrk"`,
        ).then(({ rows }) => new Map(
            rows
                .map((row) => [String(row.kodas), String(row.pavadinimas ?? "").trim()])
                .filter(([kodas, pavadinimas]) => pavadinimas && pavadinimas !== kodas),
        )).catch((error) => {
            evrkNamesPromise = undefined;
            throw error;
        });
    }
    return evrkNamesPromise;
}

async function attachEvrkNames(options, selected) {
    const present = new Set(options.map((option) => option.value));
    const all = [
        ...selected.filter((value) => !present.has(value)).map((value) => ({ value, count: null })),
        ...options,
    ];
    try {
        const names = await evrkNames();
        return all.map((option) => ({ ...option, label: names.get(option.value) }));
    } catch {
        return all;
    }
}

const FACET_FIELDS = {
    formosPavadinimas: { param: "forma", exclude: "forma" },
    statusoPavadinimas: { param: "statusas", exclude: "statusas" },
    evrkKodas: { param: "evrk", exclude: "evrk" },
    apskritis: { param: "apskritis", exclude: "apskritis" },
    savivaldybe: { param: "savivaldybe", exclude: "savivaldybe" },
};

export async function juridiniaiFacetOptions(field, query = {}, size = 1000, optionSearch = "") {
    const config = FACET_FIELDS[field];
    if (!config) return [];

    const selected = splitCsv(query[config.param]);
    const aggregateSize = Math.min(2000, Math.max(Number(size) || 1000, selected.length, 1000));
    let options = await termFacet(
        field,
        buildJuridiniaiQuickwitQuery(query, { exclude: [config.exclude] }),
        aggregateSize,
    );
    if (field === "evrkKodas") options = await attachEvrkNames(options, selected);
    else {
        const present = new Set(options.map((option) => option.value));
        options = [
            ...selected.filter((value) => !present.has(value)).map((value) => ({ value, count: null })),
            ...options,
        ];
    }

    const needle = foldLithuanian(String(optionSearch).trim()).toLowerCase();
    if (needle) {
        options = options.filter((option) =>
            foldLithuanian(`${option.value} ${option.label ?? ""}`).toLowerCase().includes(needle),
        );
    }
    return options.slice(0, Math.min(2000, Math.max(1, Number(size) || 1000)));
}

const EMPLOYEE_EDGES = [0, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const SALARY_EDGES = [0, 500, 750, 1000, 1250, 1500, 1750, 2000, 2500, 3000, 4000, 5000, 7500, 10000];

async function rangeHistogram(field, query, edges) {
    const ranges = edges.slice(0, -1).map((from, index) => ({ from, to: edges[index + 1] }));
    ranges.push({ from: edges.at(-1) });
    const fallback = { buckets: [], domainMin: edges[0], domainMax: edges.at(-1) };
    try {
        const data = await aggregate(query, { values: { range: { field, ranges } } });
        const buckets = (data?.aggregations?.values?.buckets ?? []).map((bucket) => ({
            from: Number(bucket.from ?? 0),
            to: bucket.to == null ? null : Number(bucket.to),
            count: Number(bucket.doc_count),
        })).filter((bucket) => bucket.to == null || bucket.to > bucket.from);
        return { buckets, domainMin: edges[0], domainMax: edges.at(-1) };
    } catch {
        return fallback;
    }
}

async function registrationHistogram(query) {
    const currentYear = new Date().getUTCFullYear() + 1;
    const fallback = { buckets: [], domainMin: Date.parse("1900-01-01"), domainMax: Date.parse(`${currentYear}-01-01`) };
    try {
        const data = await aggregate(
            `${query} AND registravimoData:[1900-01-01T00:00:00Z TO ${currentYear}-01-01T00:00:00Z]`,
            { values: { date_histogram: { field: "registravimoData", fixed_interval: "365d" } } },
        );
        const all = (data?.aggregations?.values?.buckets ?? []).map((bucket) => ({
            from: Number(bucket.key),
            to: Number(bucket.key) + 365 * 86_400_000,
            count: Number(bucket.doc_count),
        }));
        const first = all.findIndex((bucket) => bucket.count > 0);
        const last = all.findLastIndex((bucket) => bucket.count > 0);
        if (first < 0) return fallback;
        const buckets = all.slice(first, last + 1);
        return { buckets, domainMin: buckets[0].from, domainMax: buckets.at(-1).to };
    } catch {
        return fallback;
    }
}

export async function juridiniaiFacets(query) {
    const q = (excluded) => buildJuridiniaiQuickwitQuery(query, { exclude: excluded });
    const [registracijaRaw, formos, statusai, apskritys, savivaldybes, evrk, darbuotojai, atlyginimas, registravimoData] = await Promise.all([
        termFacet("isregistruotas", q(["registracija"]), 2),
        termFacet("formosPavadinimas", q(["forma"]), 20),
        termFacet("statusoPavadinimas", q(["statusas"]), 12),
        termFacet("apskritis", q(["apskritis"]), 12),
        termFacet("savivaldybe", q(["savivaldybe"]), 20),
        termFacet("evrkKodas", q(["evrk"]), 25),
        rangeHistogram("darbuotojai", q(["darbuotojai"]), EMPLOYEE_EDGES),
        rangeHistogram("vidutinisAtlyginimas", q(["atlyginimas"]), SALARY_EDGES),
        registrationHistogram(q(["registravimoData"])),
    ]);
    const registrationCounts = new Map(registracijaRaw.map((item) => [item.value, item.count]));
    return {
        registracija: [
            { value: "registruoti", count: registrationCounts.get("false") ?? 0 },
            { value: "isregistruoti", count: registrationCounts.get("true") ?? 0 },
        ],
        formos,
        statusai,
        apskritys,
        savivaldybes,
        evrk: await attachEvrkNames(evrk, splitCsv(query.evrk)),
        darbuotojai,
        atlyginimas,
        registravimoData,
    };
}

export async function searchJuridiniai(query = {}, { page = 1, limit = 50, includeFacets = true } = {}) {
    const effectivePage = Math.max(1, Number(page) || 1);
    const effectiveLimit = Math.min(100, Math.max(1, Number(limit) || 50));
    const started = performance.now();
    const params = { query: buildJuridiniaiQuickwitQuery(query), sort_by: sortBy(query) };
    const [result, facets] = await Promise.all([
        quickwitSearch(LENTELE, params, { minHits: effectivePage * effectiveLimit }),
        includeFacets ? juridiniaiFacets(query) : Promise.resolve(null),
    ]);
    const offset = (effectivePage - 1) * effectiveLimit;
    return {
        results: result.hits.slice(offset, offset + effectiveLimit),
        total: result.numHitsEstimate ?? result.hits.length,
        // Kai Quickwit grąžino visą rezultatų aibę, `total` yra tikslus, ne spėjimas.
        exact: result.hitsExact === true,
        facets,
        elapsed: performance.now() - started,
    };
}
