import { getDeadRatio, search as quickwitSearch, searchAll as quickwitSearchAll, countDocs as quickwitCountDocs } from "../../quickwit/quickwit.js";
import { specialJarCodes } from "../juridiniai/specialJarCodes.js";
import { searchJar } from "../juridiniai/search.js";
import { postgres } from "../../postgres/postgres.js";
import { FilterBuilder } from "../../utils/filter.js";
import { fixHtmlEntities } from "../../utils/fixHtmlEntities.js";
import { Transform, Readable } from "node:stream";
import { CONTRACT_TYPES } from "./contractTypes.js";
import QueryStream from "pg-query-stream";
import { createTtlPromiseCache } from "../../utils/ttlPromiseCache.js";
// Diakritikų nuėmimas („ą" sutampa su „a") — indeksas laikomas suredukuotas
// lygiai taip pat, kaip ir dokumentuose.
import { foldLithuanian } from "../../utils/text.js";
import { QW_URL } from "../../quickwit/qwHttp.js";
import {
    VPM_SUTARTIS_ROW_FROM,
    VPM_SUTARTIS_ROW_SELECT,
} from "./vpmSutartisRow.js";

const cachedHomepageSearch = createTtlPromiseCache(5_000);

// Kableliu atskirtų reikšmių pagalbininkai (multi-select facetai). Vieną reikšmę
// grąžina kaip paprastą atitiktį, kelias — sujungtas OR.
const splitCsv = (val) => String(val ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const pgMultiEq = (col) => (addParam, val) => {
    const vals = splitCsv(val);
    if (!vals.length) return null;
    return `(${vals.map((v) => `${col} = ${addParam(v)}`).join(" OR ")})`;
};
const tsMultiEq = (col) => (val) => {
    const vals = splitCsv(val);
    if (!vals.length) return null;
    return `(${vals.map((v) => `${col}:=${v}`).join(" || ")})`;
};

const sutartysFilter = new FilterBuilder({
    fields: [
        {
            key: "perkanciosiosOrganizacijosKodas",
            hidden: true,
            pgOverride: pgMultiEq(`s."perkanciosiosOrganizacijosKodas"`),
            tsOverride: tsMultiEq("perkanciosiosOrganizacijosKodas"),
        },
        {
            key: "tiekejoKodas",
            hidden: true,
            pgOverride: (addParam, val) => {
                const vals = splitCsv(val);
                if (!vals.length) return null;
                return `(${vals
                    .map((v) => {
                        const mainParam = addParam(v);
                        const extraParam = addParam(v);
                        return `(s."pirmoTiekejoKodas" = ${mainParam} OR EXISTS (
                            SELECT 1 FROM public."vpmSutartysPapildomiTiekejai" pt
                            WHERE pt."unikalusId" = s."unikalusId"
                              AND pt."tiekejoKodas" = ${extraParam}
                        ))`;
                    })
                    .join(" OR ")})`;
            },
            tsOverride: (val) => {
                const vals = splitCsv(val);
                if (!vals.length) return null;
                return `(${vals
                    .map((v) => `(tiekejoKodas:=${v} || papildomiTiekejaiKodai:=[${v}])`)
                    .join(" || ")})`;
            },
        },
        { key: "sutartiesNumeris", col: `s."sutartiesNumeris"`, hidden: true },
        { key: "pirkimoNumeris", col: `s."pirkimoNumeris"`, hidden: true },
        {
            key: "sutartiesUnikalusID",
            col: `s."unikalusId"`,
            tsCol: "sutartiesUnikalusId",
            type: "integer",
            hidden: true,
        },
        {
            key: "tipas",
            hidden: true,
            pgOverride: pgMultiEq(`tipas.tipas`),
            tsOverride: tsMultiEq("tipas"),
        },
        {
            key: "kategorija",
            hidden: true,
            pgOverride: pgMultiEq(`kategorija.kategorija`),
            tsOverride: tsMultiEq("kategorija"),
        },
        {
            key: "sudarymoDataNuo",
            col: `s."sudarymoData"`,
            tsCol: "sudarymoData",
            type: "gte_date",
            hidden: true,
        },
        {
            key: "sudarymoDataIki",
            col: `s."sudarymoData"`,
            tsCol: "sudarymoData",
            type: "lte_date",
            hidden: true,
        },
        { key: "verteNuo", col: `s."numatomaVerte"`, tsCol: "verte", type: "gte_number", hidden: true },
        { key: "verteIki", col: `s."numatomaVerte"`, tsCol: "verte", type: "lte_number", hidden: true },
        { key: "sumaNuo", col: `s.verte`, tsCol: "suma", type: "gte_number", hidden: true },
        { key: "sumaIki", col: `s.verte`, tsCol: "suma", type: "lte_number", hidden: true },
        {
            key: "tikSuDokumentais",
            isBoolean: true,
            hidden: true,
            pgOverride: () => `s."failuSkaicius" > 0`,
            tsOverride: () => `dokumentuKiekis:>0`,
        },
        {
            key: "ignoruotiSp",
            isBoolean: true,
            hidden: true,
            pgOverride: () => `tipas.tipas != 'SP'`,
            tsOverride: () => `tipas:!=SP`,
        },
        { key: "search", col: `search."searchTsv"`, type: "tsvector", pgOnly: true },
        {
            key: "bvpzPrefiksas",
            col: `s."bvpzKodas"::text`,
            type: "prefix_range",
            hidden: true,
            pgOnly: true,
        },
        {
            key: "bvpzPrefiksasKitas",
            col: `s."bvpzKodas"::text`,
            type: "prefix_range",
            hidden: true,
            pgOnly: true,
        },
    ],
    sort: {
        default: "paskutinioRedagavimoData",
        defaultDir: "desc",
        allowed: [
            "paskutinioRedagavimoData",
            "sudarymoData",
            "verte",
            "paskelbimoData",
            "suma",
        ],
        nullsLast: true,
    },
});

const FIXED_WHERE = [`s.istrinta = false`];

export function getSutartysQueryMetadata(query) {
    const { values, queryParams } = sutartysFilter.build(query);
    return { values, queryParams };
}

// Visi sutarčių stulpeliai išskyrus search_tsv — sugeneruotas tsvector yra
// didelis ir rezultatuose nereikalingas (nutekėtų ir į MCP atsakymus).
export const SUTARTYS_COLUMNS = VPM_SUTARTIS_ROW_SELECT;
const SUTARTYS_FROM = VPM_SUTARTIS_ROW_FROM;

const QUICKWIT_LENTELE = "sutartys";
const QUICKWIT_PAGE_SIZE = 50;
export const SUTARTYS_EXPORT_LIMIT = 100_000;
const QUICKWIT_EXPORT_WINDOW = 5_000;

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

function qwDate(raw, endOfDay = false) {
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

    const rawSearch = (query.search ?? "").trim();
    if (rawSearch && rawSearch !== "*") {
        // Foldinam, nuimam kabutes (kad neįsimaišytų į frazės sintaksę) ir
        // ekranuojam atgalinius brūkšnius, kad neišsprūstų iš skliaustų.
        const folded = foldLithuanian(rawSearch.replace(/"/g, "")).replace(/\\/g, "\\\\");
        parts.push(
            `(${QUICKWIT_TEXT_FIELDS.map((f) => `${f}:(${folded})`).join(" OR ")})`,
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
        const sumaNuo = query.sumaNuo != null && parseFloat(String(query.sumaNuo).replace(",", "."));
        const sumaIki = query.sumaIki != null && parseFloat(String(query.sumaIki).replace(",", "."));
        if (Number.isFinite(sumaNuo)) parts.push(`suma:[${sumaNuo} TO *]`);
        if (Number.isFinite(sumaIki)) parts.push(`suma:[* TO ${sumaIki}]`);
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
function quickwitSortBy(query) {
    const allowed = new Set([
        "paskutinioRedagavimoData",
        "sudarymoData",
        "verte",
        "paskelbimoData",
        "suma",
    ]);
    const col = allowed.has(query.sort) ? query.sort : "paskutinioRedagavimoData";
    const dir = ["asc", "desc"].includes((query.sortDir || "").toLowerCase())
        ? query.sortDir.toLowerCase()
        : "desc";
    return dir === "desc" ? col : `-${col}`;
}

// ── Facetai (Quickwit agregacijos) ───────────────────────────────────────────
// Kaip /dokumentai: kiekvienas facetas — term agregacija, apskaičiuota pagal
// užklausą, iš kurios pašalintas TO PATIES faceto filtras, kad matytųsi visos
// reikšmės po kitų filtrų. Kodiniai facetai (pirkėjai/tiekėjai/BVPŽ) papildomi
// žmogui skirtais pavadinimais.

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

async function sutartysQuickwitAggregates(query) {
    try {
        const [deadRatio, res] = await Promise.all([
            getDeadRatio(QUICKWIT_LENTELE),
            fetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    query: buildSutartysQuickwitQuery(query),
                    max_hits: 0,
                    aggs: { suma: { sum: { field: "suma" } } },
                    format: "json",
                }),
            }),
        ]);
        if (!res.ok) return { sutarciuKiekis: null, bendraVerte: null };
        const data = await res.json();
        const liveRatio = Math.max(0, 1 - deadRatio);
        return {
            sutarciuKiekis: Math.round(Number(data?.num_hits ?? 0) * liveRatio),
            bendraVerte: Number(data?.aggregations?.suma?.value ?? 0) * liveRatio,
        };
    } catch {
        return { sutarciuKiekis: null, bendraVerte: null };
    }
}

// Sumos pasiskirstymo (histogramos) log-skalės kraštinės (€): ~5 žingsniai
// dekadai (1,2,3,5,7) nuo 10 iki 100 mln. Paskutinis kaušas — „nuo 100 mln."
// (viskas virš). Slankiklio domenas: [0, paskutinė kraštinė].
const SUMA_EDGES = (() => {
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
 * Sumos (faktinės vertės) pasiskirstymas log kaušais pagal esamą užklausą, iš
 * kurios pašalintas pats sumos filtras (facet-exclude) — kad matytųsi visa
 * histograma, o slankiklis tik paryškintų pasirinktą rėžį.
 * Domenas dinamiškas: nukerpami tušti (0 sutarčių) kaušai galuose, tad
 * `domainMin`/`domainMax` atspindi realų duomenų rėžį pagal esamą užklausą.
 * @param {object} query
 * @returns {Promise<{ buckets: { from: number, to: number|null, count: number }[], domainMin: number, domainMax: number }>}
 */
export async function sutartysSumaHistogram(query) {
    const edgeMax = SUMA_EDGES[SUMA_EDGES.length - 1];
    const fallback = { buckets: [], domainMin: 0, domainMax: edgeMax };
    const ranges = SUMA_EDGES.slice(0, -1).map((from, i) => ({ from, to: SUMA_EDGES[i + 1] }));
    ranges.push({ from: edgeMax });

    const qwQuery = buildSutartysQuickwitQuery(query, { exclude: ["suma"] });
    try {
        const res = await fetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: qwQuery,
                max_hits: 0,
                aggs: { suma: { range: { field: "suma", ranges } } },
                format: "json",
            }),
        });
        if (!res.ok) return fallback;
        const data = await res.json();
        const all = (data?.aggregations?.suma?.buckets ?? [])
            .map((b) => ({
                from: Number(b.from ?? 0),
                to: b.to != null ? Number(b.to) : null,
                count: Number(b.doc_count),
            }))
            // Quickwit prideda numatytą „žemiau pirmos ribos" kaušą (iki 0) —
            // praleidžiam degeneruotus (to <= from) kaušus.
            .filter((b) => b.to === null || b.to > b.from);
        if (!all.length) return fallback;

        // Dinamiškas domenas skaičiuojamas TIKSLIAI iš kaušų skaičių (ne iš
        // apytikslių Quickwit procentilių, kurie su kitais facetais / mažais
        // rinkiniais klysta): nukerpam po ~1% masės iš abiejų galų, tad
        // slankiklis „priartinamas" prie ten, kur duomenys. Kraštinės rankenėlės
        // reiškia „be ribos", tad išskirtys vis tiek pasiekiamos.
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

        // Praplečiam iki bent 10 stulpelių — kitaip histograma per skurdi.
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

// Laikotarpio histogramos bazinis (smulkiausias) intervalas. Quickwit
// `date_histogram` priima tik fiksuotus intervalus (d/h/…), ne kalendorinius
// mėnesius — imam ~mėnesį (30 d.); tankumas vėliau adaptuojamas grupuojant.
const DATA_INTERVAL = "30d";
const DATA_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
// Sveiko proto laikotarpio rėžiai (grafikui ir slankikliui): nuo 2013-01-01 iki
// kitų metų sausio 1 d. Duomenyse pasitaiko klaidingų datų (pvz. 1905 ar 2055 m.);
// už šių ribų esančios sutartys į histogramą neįtraukiamos.
const DATA_BOUND_MIN = "2013-01-01";
const dataBoundMax = () => `${new Date().getUTCFullYear() + 1}-01-01`;

/**
 * Sutarčių sudarymo datų (`sudarymoData`) pasiskirstymas pagal esamą užklausą, iš
 * kurios pašalintas pats datos filtras (facet-exclude). Naudoja Quickwit
 * `date_histogram` (~mėnesio kaušai), nukerpa tuščius galus ir adaptyviai sujungia
 * gretimus kaušus, kad liktų ~24–40 stulpelių bet kokiam rėžiui. `from`/`to` —
 * epoch millis (slankiklio domenas).
 * @param {object} query
 * @returns {Promise<{ buckets: { from: number, to: number|null, count: number }[], domainMin: number, domainMax: number }>}
 */
export async function sutartysDataHistogram(query) {
    const boundMin = qwDate(DATA_BOUND_MIN);
    const boundMax = qwDate(dataBoundMax());
    const fallback = { buckets: [], domainMin: Date.parse(DATA_BOUND_MIN), domainMax: Date.parse(dataBoundMax()) };
    // Prie užklausos prikabinam sveiko proto rėžius, kad klaidingos išskirtys
    // (už [2013 .. kiti metai] ribų) neišpūstų histogramos domeno.
    const qwQuery = [
        buildSutartysQuickwitQuery(query, { exclude: ["sudarymoData"] }),
        `sudarymoData:[${boundMin} TO ${boundMax}]`,
    ].join(" AND ");
    try {
        const res = await fetch(`${QW_URL}/api/v1/${QUICKWIT_LENTELE}_*/search`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                query: qwQuery,
                max_hits: 0,
                aggs: { data: { date_histogram: { field: "sudarymoData", fixed_interval: DATA_INTERVAL } } },
                format: "json",
            }),
        });
        if (!res.ok) return fallback;
        const data = await res.json();
        // `key` — kaušo pradžia epoch millis; kaušai gretimi (min_doc_count=0).
        let all = (data?.aggregations?.data?.buckets ?? []).map((b) => ({
            from: Number(b.key),
            to: Number(b.key) + DATA_INTERVAL_MS,
            count: Number(b.doc_count),
        }));
        if (!all.length) return fallback;

        // Išskirtys jau atkirstos užklausos rėžiais, tad tiesiog nukerpam tuščius
        // (0 sutarčių) galus — parodom visą užpildytą rėžį sveiko proto ribose.
        let start = 0;
        while (start < all.length && all[start].count === 0) start++;
        let end = all.length - 1;
        while (end > start && all[end].count === 0) end--;
        if (start > end) return fallback;
        all = all.slice(start, end + 1);

        // Adaptyvus tankumas: sujungiam gretimus kaušus (×3 ketvirtis, ×12 metai …),
        // kad stulpelių liktų ~iki 36 — juosta visada gražiai užpildyta.
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

/** Papildo kodinius facetus (pirkėjai/tiekėjai) įstaigų/įmonių pavadinimais iš
 *  jar lentelės. Nerasti kodai lieka be label. */
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
    // Specialūs CVP IS bendriniai kodai (801–809) neturi įrašo jar lentelėje —
    // jų pavadinimus imam iš specialJarCodes žinyno.
    return options.map((o) => ({
        ...o,
        label: names.get(o.value) ?? specialJarCodes[o.value]?.pavadinimas,
    }));
}

/** Papildo BVPŽ facetus pavadinimais. Bucket'o raktas — pilnas kodas su
 *  kontroline skiltimi (pvz. „15800000-6"); facete rodom 8 skaitmenų kodą
 *  (filtravimo reikšmę), pavadinimą imam iš „bvpzKodai" žodyno pagal `code`. */
async function attachBvpzNames(options) {
    // Sutraukiam iki 8 skaitmenų kodo ir sumuojam (vienam kodui — viena eilutė).
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

/** Pažymėtus BVPŽ prefiksus išrenka iš užklausos (matomas + paslėptas laukas). */
function selectedBvpzPrefixes(query) {
    return [...new Set(
        [query.bvpzPrefiksas, query.bvpzPrefiksasKitas]
            .filter(Boolean)
            .flatMap((raw) => String(raw).split(" "))
            .map((p) => p.trim())
            .filter(Boolean),
    )];
}

/** Pažymėtiems BVPŽ prefiksams priskiria prefiksinės atitikties sutarčių skaičių
 *  pagal kitus filtrus (facet-exclude), kad šoninėje juostoje ir dialoge nepilni
 *  kodai rodytųsi su „*" ženklu ir sutarčių skaičiumi. Pavadinimo nerodom — vien
 *  kodas su „*", kad aiškiai skirtųsi nuo konkretaus (pilno) kodo. */
async function attachSelectedBvpz(prefixes, query) {
    const uniq = [...new Set(prefixes)].filter(Boolean);
    if (!uniq.length) return [];
    const base = buildSutartysQuickwitQuery(query, { exclude: ["bvpz"] });
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

/**
 * Suskaičiuoja visus sutarčių šoninės juostos facetus vienai užklausai.
 * Kiekvienas facetas naudoja facet-exclude, kad rodytų reikšmes pagal kitus
 * filtrus. Grąžina map'ą facetų pavadinimas → [{ value, label?, count }].
 * @param {object} query
 * @returns {Promise<{ tipas: object[], kategorija: object[], buyers: object[], suppliers: object[], bvpz: object[] }>}
 */
export async function sutartysFacets(query) {
    const q = (excl) => buildSutartysQuickwitQuery(query, { exclude: excl });
    const selBuyers = splitCsv(query.perkanciosiosOrganizacijosKodas);
    const selSuppliers = splitCsv(query.tiekejoKodas);

    const [tipas, kategorija, buyers, suppliers, bvpz, suma, laikotarpis] = await Promise.all([
        qwFacet("tipas", q(["tipas"]), 15),
        qwFacet("kategorija", q(["kategorija"]), 6),
        qwFacet("perkanciosiosOrganizacijosKodas", q(["perkanciosiosOrganizacijosKodas"]), 8),
        qwFacet("tiekejaiKodai", q(["tiekejoKodas"]), 8),
        qwFacet("bvpzKodai", q(["bvpz"]), 10),
        sutartysSumaHistogram(query),
        sutartysDataHistogram(query),
    ]);

    const [buyersNamed, suppliersNamed, bvpzNamed, bvpzSelected] = await Promise.all([
        attachJarNames(buyers),
        attachJarNames(suppliers),
        attachBvpzNames(bvpz),
        attachSelectedBvpz(selectedBvpzPrefixes(query), query),
    ]);

    // Pasirinktus BVPŽ prefiksus (nepilnus kodus), kurių nėra tarp dažniausių,
    // pridedam priekyje su pavadinimu + prefiksinės atitikties skaičiumi.
    const bvpzPresent = new Set(bvpzNamed.map((o) => o.value));
    const bvpzFinal = [...bvpzSelected.filter((o) => !bvpzPresent.has(o.value)), ...bvpzNamed];

    // Pasirinktus (įsk. „custom" įvestus) kodus, kurių nėra tarp dažniausių,
    // pridedam priekyje su JAR pavadinimu — kad šoninėje juostoje matytųsi ne
    // vien kodas, o ir pavadinimas (ir kad jie tilptų į matomus, ne perpildą).
    const withSelected = async (named, selected) => {
        const present = new Set(named.map((o) => o.value));
        const missing = selected.filter((v) => !present.has(v));
        if (!missing.length) return named;
        const resolved = await attachJarNames(missing.map((v) => ({ value: v, count: null })));
        return [...resolved, ...named];
    };

    const [buyersFinal, suppliersFinal] = await Promise.all([
        withSelected(buyersNamed, selBuyers),
        withSelected(suppliersNamed, selSuppliers),
    ]);

    return {
        tipas: tipas.filter((o) => o.value),
        kategorija: kategorija.filter((o) => o.value),
        buyers: buyersFinal,
        suppliers: suppliersFinal,
        bvpz: bvpzFinal,
        suma,
        laikotarpis,
    };
}

// Facetų laukas → „iš užklausos pašalinamo" filtro raktas (facet-exclude), kad
// „Daugiau" dialogo sąrašas rodytų visas reikšmes pagal kitus filtrus.
const FACET_FIELD_EXCLUDE = {
    perkanciosiosOrganizacijosKodas: "perkanciosiosOrganizacijosKodas",
    tiekejaiKodai: "tiekejoKodas",
    bvpzKodai: "bvpz",
};

/**
 * Pilnas vieno facetų lauko reikšmių sąrašas pagal esamą užklausą/filtrus —
 * maitina „Daugiau" dialogą (kaip /dokumentai). `optionSearch` leidžia ieškoti
 * JAR registre (kodu ar pavadinimu) reikšmių, kurių gali nebūti tarp dažniausių.
 * @param {'perkanciosiosOrganizacijosKodas'|'tiekejaiKodai'|'bvpzKodai'} field
 * @param {object} query
 * @param {number} [size=1000]
 * @param {string} [optionSearch='']
 * @returns {Promise<{ value: string, label?: string, count: number|null }[]>}
 */
export async function sutartysFacetOptions(field, query, size = 1000, optionSearch = "") {
    const excludeKey = FACET_FIELD_EXCLUDE[field];
    if (!excludeKey) return [];

    const qwQuery = buildSutartysQuickwitQuery(query, { exclude: [excludeKey] });
    const buckets = (await qwFacet(field, qwQuery, size)).filter((b) => b.value);

    // BVPŽ: kodus sutraukiam iki 8 skaitmenų + pavadinimai iš „bvpzKodai" žinyno;
    // paieška — pagal kodo prefiksą ar pavadinimą (registro/žinyno papildymas).
    if (field === "bvpzKodai") {
        const options = await attachBvpzNames(buckets);
        if (!optionSearch) {
            // Pažymėtus prefiksus (nepilnus kodus) rodom priekyje su „*" ženklu
            // ir prefiksinės atitikties skaičiumi — kaip šoninėje juostoje.
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

    // Registro paieška: skaičius → kodo prefiksas jar lentelėje; kitaip — vardo
    // paieška. Skaičius iš agregacijos prisegam prie rasto kodo (kiek sutarčių).
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

/**
 * Loads complete contract rows from PostgreSQL while preserving search engine order.
 * Missing or deleted PostgreSQL rows are omitted.
 * @param {{ id?: string | number }[]} searchRows
 * @returns {Promise<object[]>}
 */
async function loadSearchRowsFromPostgres(searchRows) {
    const ids = searchRows
        .map((row) => Number(row.id))
        .filter(Number.isSafeInteger);

    if (ids.length === 0) return [];

    const { rows } = await postgres.query(
        `SELECT ${SUTARTYS_COLUMNS}
         FROM ${SUTARTYS_FROM}
         WHERE s."unikalusId" = ANY($1::bigint[])
           AND s.istrinta = false`,
        [ids],
    );
    const rowsById = new Map(
        rows.map((row) => [Number(row.sutartiesUnikalusId), row]),
    );

    return ids.map((id) => rowsById.get(id)).filter(Boolean);
}

/**
 * Iterates a large Quickwit export without deep offsets. Each 5k window is
 * sorted by the unique contract ID; the next query starts strictly after the
 * final raw Quickwit hit, so tombstones at a window boundary cannot skip rows.
 * @param {object} query
 * @param {object} [options]
 * @param {number} [options.limit]
 * @param {AbortSignal} [options.signal]
 * @param {(progress: {processed: number}) => void} [options.onBatch]
 */
export async function* iterateSutartysQuickwitExport(
    query,
    { limit = SUTARTYS_EXPORT_LIMIT, signal, onBatch } = /** @type {any} */ ({}),
) {
    const baseQuery = buildSutartysQuickwitQuery(query);
    let afterId = null;
    let processed = 0;

    while (processed < limit) {
        if (signal?.aborted) throw new DOMException("Exportas atšauktas", "AbortError");
        const cursorQuery = afterId == null
            ? baseQuery
            : `(${baseQuery}) AND sutartiesUnikalusId:{${afterId} TO *]`;
        const result = await quickwitSearchAll(
            QUICKWIT_LENTELE,
            { query: cursorQuery, sort_by: "-sutartiesUnikalusId" },
            {
                limit: Math.min(QUICKWIT_EXPORT_WINDOW, limit - processed),
                pageSize: Math.min(QUICKWIT_EXPORT_WINDOW, limit - processed),
                maxPages: 1,
            },
        );
        const rawCursor = Number(result.lastRawHit?.sutartiesUnikalusId);
        const rows = await loadSearchRowsFromPostgres(
            result.hits.map((hit) => ({ id: hit.sutartiesUnikalusId })),
        );

        for (const row of rows) {
            if (processed >= limit) return;
            processed++;
            yield aptvarkytiRezultata(row);
        }
        onBatch?.({ processed });

        if (!Number.isSafeInteger(rawCursor) || rawCursor === afterId || result.rawExhausted) return;
        afterId = rawCursor;
    }
}

/**
 * @typedef {"postgres" | "quickwit"} Engine
 */

/**
 * @typedef {object} SearchOptions
 * @property {number | null} [limit] - Rows per page.
 * @property {number} [page=1] - Current page number.
 * @property {Engine} [engine="postgres"] - Search engine to use.
 * @property {boolean} [stream=false] - Return a raw stream instead of rows.
 *   When true, caller must release the returned `client`.
 * @property {boolean} [sort=true] - Whether to apply default sorting.
 * @property {boolean} [includeAggregates=false] - Compute matching row count and
 *   value sum for selective entity filters.
 * @property {boolean} [includeFacets=false] - Compute Quickwit sidebar facets
 *   (only meaningful for the `quickwit` engine).
 */

/**
 * @typedef {Record<string, any> & {
 *   sutartiesUnikalusId: string | number,
 *   tipas: string,
 *   kategorija: string,
 *   perkanciosiosOrganizacijosKodas: string,
 *   perkanciojiOrganizacija: string,
 *   pavadinimas: string,
 *   tiekejai: string[],
 *   tiekejaiKodai: string[],
 *   bvpzKodai: string[]
 * }} ContractSearchRow
 */

/**
 * @typedef {object} SearchResult
 * @property {ContractSearchRow[]} results - Processed rows. Empty when streaming.
 * @property {number | null} total - Total matching rows. Null if count timed out.
 * @property {number | null} sutarciuKiekis - Matching row count when aggregates were requested.
 * @property {number | null} bendraVerte - Matching value sum when aggregates were requested.
 * @property {{ tipas: object[], kategorija: object[], buyers: object[], suppliers: object[], bvpz: object[] } | null} [facets] - Quickwit sidebar facets when includeFacets is set.
 * @property {object} values - Resolved filter values for form repopulation.
 * @property {string} queryParams - URL query string fragment for pagination links.
 * @property {{label: string, phase: string, start: number, duration: number}[]} timings
 * @property {import("node:stream").Readable | null} stream - Raw stream, or null.
 * @property {import("pg").PoolClient | null} client - Live pg client when streaming, else null.
 */

/**
 * Searches the sutartys table using Postgres or Quickwit.
 * @param {object} query - Express request query object.
 * @param {SearchOptions} options
 * @returns {Promise<SearchResult>}
 */
async function searchSutartysUncached(
    query,
    {
        limit,
        page = 1,
        engine = "postgres",
        stream = false,
        sort = true,
        includeAggregates = false,
        includeFacets = false,
    } = {},
) {
    const searchStarted = performance.now();

    // Quickwit variklis naudojamas tik nestriminei paieškai — eksportai
    // (stream) tebeeina Postgres keliu žemiau. Rezultatų eilutės pilnai
    // užkraunamos iš Postgres išsaugant Quickwit tvarką.
    if (engine === "quickwit" && !stream) {
        const { values, queryParams } = sutartysFilter.build(query);

        const qwQuery = buildSutartysQuickwitQuery(query);
        const effLimit = limit ?? QUICKWIT_PAGE_SIZE;

        const quickwitStarted = performance.now();
        // Pagrindinė paieška ir facetų agregacijos vyksta lygiagrečiai.
        const aggregatePromise = includeAggregates
            ? sutartysQuickwitAggregates(query)
            : Promise.resolve({ sutarciuKiekis: null, bendraVerte: null });
        const [result, facets, aggregates] = await Promise.all([
            quickwitSearch(
                QUICKWIT_LENTELE,
                { query: qwQuery, sort_by: quickwitSortBy(query) },
                { minHits: page * effLimit },
            ),
            includeFacets ? sutartysFacets(query) : Promise.resolve(null),
            aggregatePromise,
        ]);
        const quickwitEnded = performance.now();

        const pageHits = result.hits.slice((page - 1) * effLimit, page * effLimit);

        const postgresStarted = performance.now();
        const rows = await loadSearchRowsFromPostgres(
            pageHits.map((h) => ({ id: h.sutartiesUnikalusId })),
        );
        const postgresEnded = performance.now();

        return {
            results: rows.map(aptvarkytiRezultata),
            total: result.numHitsEstimate ?? result.hits.length,
            sutarciuKiekis: aggregates.sutarciuKiekis,
            bendraVerte: aggregates.bendraVerte,
            facets,
            values,
            queryParams,
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

    // Eksportai (stream) su Quickwit varikliu: atrenkam atitinkančius įrašus per
    // Quickwit (kaip ir ekrane — su prefiksais/wildcard'ais), tada pilnas eilutes
    // užkraunam iš Postgres išsaugant Quickwit tvarką. Kitaip eksportas eitų per
    // Postgres pilnatekstę paiešką (`plainto_tsquery`), kuri `brok*` traktuoja kaip
    // tikslų leksemą ir grąžina kitą (dažnai tuščią) rinkinį nei rodoma ekrane.
    if (engine === "quickwit" && stream) {
        const { values, queryParams } = sutartysFilter.build(query);
        const effLimit = limit ?? SUTARTYS_EXPORT_LIMIT;

        return {
            results: [],
            total: null,
            sutarciuKiekis: null,
            bendraVerte: null,
            values,
            queryParams,
            timings: [],
            stream: Readable.from(iterateSutartysQuickwitExport(query, { limit: effLimit }), { objectMode: true }),
            client: null,
        };
    }

    const { sql, sqlCount, params, paramsCount, values, queryParams } =
        sutartysFilter.build(query, {
            table: SUTARTYS_FROM,
            select: SUTARTYS_COLUMNS,
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
            sutarciuKiekis: null,
            bendraVerte: null,
            values,
            queryParams,
            timings: [],
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

    // Only compute aggregates when a selective entity filter is present.
    // Date/value-only ranges can span millions of rows — too slow for a SUM scan.
    const SELECTIVE_KEYS = [
        "tiekejoKodas",
        "perkanciosiosOrganizacijosKodas",
        "sutartiesNumeris",
        "pirkimoNumeris",
        "sutartiesUnikalusID",
    ];
    const needsAgg =
        includeAggregates && SELECTIVE_KEYS.some((k) => query[k] != null);

    // "suma" = faktineIvykdimoVerte when settled, otherwise verte.
    const mainQuery = postgres.query(sql, params);
    const aggQuery = needsAgg
        ? postgres.query(
              sqlCount.replace(
                  "SELECT COUNT(*)",
                  `SELECT COUNT(*) AS kiekis, COALESCE(SUM(s.verte), 0) AS "bendraVerte"`,
              ),
              paramsCount,
          )
        : Promise.resolve(null);

    const [{ rows }, aggResult] = await Promise.all([mainQuery, aggQuery]);
    const postgresEnded = performance.now();

    return {
        results: rows.map(aptvarkytiRezultata),
        total: null,
        sutarciuKiekis: aggResult ? parseInt(aggResult.rows[0].kiekis, 10) : null,
        bendraVerte: aggResult ? parseFloat(aggResult.rows[0].bendraVerte) : null,
        values,
        queryParams,
        timings: [
            {
                label: "PostgreSQL",
                phase: "pg",
                start: 0,
                duration: Math.round(postgresEnded - searchStarted),
            },
        ],
        stream: null,
        client: null,
    };
}

export async function searchSutartys(query, options = {}) {
    const {
        limit,
        page = 1,
        engine = "postgres",
        stream = false,
        sort = true,
        includeAggregates = false,
        includeFacets = false,
    } = options;
    const { visiIrasai, orderBy } = sutartysFilter.build(query);

    if (stream || page !== 1 || !visiIrasai) {
        return searchSutartysUncached(query, options);
    }

    const cacheKey = JSON.stringify({
        limit: limit ?? null,
        engine,
        sort,
        orderBy,
        includeAggregates,
        includeFacets,
    });
    return cachedHomepageSearch(cacheKey, () =>
        searchSutartysUncached(query, options),
    );
}

/**
 * Returns a precise COUNT of sutartys rows matching the given query.
 * @param {object} query - Express request query object.
 * @returns {Promise<number>}
 */
export async function countSutartys(query) {
    const { sqlCount, params, visiIrasai } = sutartysFilter.build(query, {
        table: SUTARTYS_FROM,
        fixedWhere: FIXED_WHERE,
    });

    if (visiIrasai) {
        const { rows } = await postgres.query(
            `SELECT COUNT(*) AS "rowCount" FROM public."vpmSutartys" WHERE istrinta = false`,
        );
        return Number(rows[0].rowCount);
    }

    const { rows } = await postgres.query(sqlCount, params);
    return parseInt(rows[0].count, 10);
}

/**
 * Įvertintas atitinkančių gyvų sutarčių skaičius per Quickwit — atspindi tą patį
 * rinkinį kaip ekrane (su prefiksais/wildcard'ais), skirtingai nei Postgres
 * `countSutartys`. Naudojama eksporto ribų tikrinimui, kai variklis — Quickwit.
 * @param {object} query
 * @returns {Promise<number>}
 */
export async function countSutartysQuickwit(query) {
    return quickwitCountDocs(QUICKWIT_LENTELE, {
        query: buildSutartysQuickwitQuery(query),
    });
}

/**
 * @param {Record<string, any>} r
 * @returns {ContractSearchRow}
 */
export function aptvarkytiRezultata(r) {
    if (r.id) {
        r.sutartiesUnikalusId = r.id;
        delete r.id;
    }
    if (r.sutartiesUnikalusID) {
        r.id = r.sutartiesUnikalusID;
        delete r.sutartiesUnikalusID;
    }

    r.bvpzKodai = [r.bvpzKodas, ...(r.papildomiBvpzKodai ?? [])];
    delete r.bvpzKodas;
    delete r.papildomiBvpzKodai;

    r.bvpzPavadinimai = [
        r.bvpzPavadinimas,
        ...(r.papildomiBvpzPavadinimai ?? []),
    ];
    delete r.bvpzPavadinimas;
    delete r.papildomiBvpzPavadinimai;

    r.tiekejai = [r.tiekejas, ...(r.papildomiTiekejai ?? [])];
    delete r.tiekejas;
    delete r.papildomiTiekejai;

    r.tiekejaiKodai = [r.tiekejoKodas, ...(r.papildomiTiekejaiKodai ?? [])];
    delete r.tiekejoKodas;
    delete r.papildomiTiekejaiKodai;

    r.pavadinimas = fixHtmlEntities(r.pavadinimas);
    r.perkanciojiOrganizacija = fixHtmlEntities(r.perkanciojiOrganizacija);
    r.tiekejai = r.tiekejai.map(fixHtmlEntities);

    const tipo = (r.tipas || "").trim().toUpperCase();
    r.tipoPavadinimas = CONTRACT_TYPES[tipo] || tipo;

    if (r.dokumentai) {
        delete r.dokumentai;
    }

    return /** @type {ContractSearchRow} */ (r);
}
