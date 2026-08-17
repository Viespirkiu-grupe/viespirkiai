import { FilterBuilder } from "../../../utils/filter.js";
import {
    VPM_SUTARTIS_ROW_FROM,
    VPM_SUTARTIS_ROW_SELECT,
} from "../vpmSutartisRow.js";

// Kableliu atskirtų reikšmių pagalbininkai (multi-select facetai). Vieną reikšmę
// grąžina kaip paprastą atitiktį, kelias — sujungtas OR.
export const splitCsv = (val) => String(val ?? "").split(",").map((s) => s.trim()).filter(Boolean);
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

export const sutartysFilter = new FilterBuilder({
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

export const FIXED_WHERE = [`s.istrinta = false`];

export function getSutartysQueryMetadata(query) {
    const { values, queryParams } = sutartysFilter.build(query);
    return { values, queryParams };
}

// Visi sutarčių stulpeliai išskyrus search_tsv — sugeneruotas tsvector yra
// didelis ir rezultatuose nereikalingas (nutekėtų ir į MCP atsakymus).
export const SUTARTYS_COLUMNS = VPM_SUTARTIS_ROW_SELECT;
export const SUTARTYS_FROM = VPM_SUTARTIS_ROW_FROM;
