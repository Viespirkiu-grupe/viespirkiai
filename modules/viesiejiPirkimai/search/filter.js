import { FilterBuilder } from "../../../utils/filter.js";
import { STATUSAS, PIRKIMO_BUDAS } from "../viesiejiPirkimaiEnums.js";

export const splitCsv = (val) => String(val ?? "").split(",").map((s) => s.trim()).filter(Boolean);

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

export const viesiejiPirkimaiFilter = new FilterBuilder({
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
                return `"bvpzKodai" && ARRAY(SELECT code FROM bvpz."kodai" WHERE ${ors.join(" OR ")})`;
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

export const FIXED_WHERE = [];

