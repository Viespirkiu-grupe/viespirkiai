import { postgres } from "../../postgres/postgres.js";

/**
 * VPT atvirų sutarčių duomenų rašymas į `vpmSutartys` schemą.
 *
 * Abu rinkiniai (naujasis ir ankstesnis „Imp") dalinasi tais pačiais žodynais,
 * tad ir vieno, ir kito paketas rašomas tuo pačiu būdu: žodynų papildymas ir
 * id parinkimas vyksta pačiame SQL (CTE + UNION ALL su ką tik įrašytomis
 * eilutėmis), kaip ir kitur projekte – jokio kešo procese.
 */

/** Tuščia reikšmė šaltinyje reiškia „nenurodyta". */
const tuscia = (v) => {
    if (v === null || v === undefined) return null;
    const t = typeof v === "string" ? v.trim() : v;
    return t === "" ? null : t;
};

/** '0'/'1' -> boolean; kitos reikšmės (ir tuščia) -> null. */
const arReiksme = (v) => {
    const t = tuscia(v);
    return t === null ? null : String(t) === "1";
};

/** Žodyno pora (kodas, pavadinimas) -> paieškos raktas su NULL'ų sutapimu. */
const poraRaktas = (a, b) => `COALESCE(${a}, '') || chr(31) || COALESCE(${b}, '')`;

const poraInsert = (lentele, kodas, pavadinimas) => `ins_${lentele} AS (
        INSERT INTO "vpmSutartys"."${lentele}" ("kodas", "pavadinimas")
        SELECT DISTINCT ${kodas}, ${pavadinimas} FROM incoming
        WHERE ${kodas} IS NOT NULL OR ${pavadinimas} IS NOT NULL
        ON CONFLICT ("kodas", "pavadinimas") DO NOTHING
        RETURNING "id", "kodas", "pavadinimas"
    )`;

const poraId = (lentele, kodas, pavadinimas) => `(
        SELECT "id" FROM "vpmSutartys"."${lentele}"
        WHERE ${poraRaktas('"kodas"', '"pavadinimas"')} = ${poraRaktas(kodas, pavadinimas)}
        UNION ALL
        SELECT "id" FROM ins_${lentele}
        WHERE ${poraRaktas('"kodas"', '"pavadinimas"')} = ${poraRaktas(kodas, pavadinimas)}
        LIMIT 1)`;

const vienoInsert = (lentele, laukas) => `ins_${lentele} AS (
        INSERT INTO "vpmSutartys"."${lentele}" ("pavadinimas")
        SELECT DISTINCT ${laukas} FROM incoming WHERE ${laukas} IS NOT NULL
        ON CONFLICT ("pavadinimas") DO NOTHING RETURNING "id", "pavadinimas"
    )`;

const vienoId = (lentele, laukas) => `(
        SELECT "id" FROM "vpmSutartys"."${lentele}" WHERE "pavadinimas" = ${laukas}
        UNION ALL
        SELECT "id" FROM ins_${lentele} WHERE "pavadinimas" = ${laukas}
        LIMIT 1)`;

/** Bendri abiem rinkiniams žodynai (be pirkimo būdo – jis tik naujajame). */
const BENDRI_ZODYNAI = [
    poraInsert("atviriTiekejai", 'i."tiekKodas"', 'i."tiekPav"'),
    poraInsert("atviriPirkejai", 'i."pvKodas"', 'i."pvPav"'),
    poraInsert("atviriCpvKodai", 'i."mcpvKodas"', 'i."mcpvPav"'),
    vienoInsert("atviriObjektai", 'i."dokSutObjPav"'),
    vienoInsert("atviriValstybes", 'i."tiekSalis"'),
];

const TIEKEJO_ID = poraId("atviriTiekejai", 'i."tiekKodas"', 'i."tiekPav"');
const PIRKEJO_ID = poraId("atviriPirkejai", 'i."pvKodas"', 'i."pvPav"');
const CPV_ID = poraId("atviriCpvKodai", 'i."mcpvKodas"', 'i."mcpvPav"');
const OBJEKTO_ID = vienoId("atviriObjektai", 'i."dokSutObjPav"');
const VALSTYBES_ID = vienoId("atviriValstybes", 'i."tiekSalis"');

/** Šaltinio laukai -> unnest() parametrų tvarka ir tipai. */
const LAUKAI = [
    ["dokId", "bigint"], ["dokRegNr", "text"], ["dokSysRegData", "date"],
    ["dokSutNumeris", "text"], ["pkPirkimoKodas", "text"],
    ["dokPirkimoNumeris", "text"], ["dokPirkimoBudas", "text"],
    ["dokSutObjPav", "text"], ["dokSutObjRusis", "text"],
    ["mcpvKodas", "text"], ["mcpvPav", "text"], ["pvKodas", "text"], ["pvPav", "text"],
    ["tiekKodas", "text"], ["tiekPav", "text"], ["tiekPavPatikslinimas", "text"],
    ["tiekSalis", "text"], ["verte", "text"], ["dokSudarymoData", "date"],
    ["dokSutGaliojimoData", "date"], ["dokSutTipas", "smallint"],
    ["dokFormosTipas", "smallint"], ["ppsZodSut", "smallint"],
    ["faktineVerte", "text"], ["dokFaktSutIvykData", "date"],
    ["arVykdomasCvpIs", "boolean"], ["arPreliminarus", "boolean"],
    ["arSusijesSuTiriamaSituacija", "boolean"], ["arSituacijaTipas1", "boolean"],
    ["arSituacijaTipas2", "boolean"], ["arSituacijaTipas3", "boolean"],
    ["dokArTaikomi", "boolean"], ["dokArNotNeededReason", "boolean"],
];

const LAUKAI_IMP = [
    ["dokId", "bigint"], ["dokSysRegData", "date"], ["dokSutNumeris", "text"],
    ["dokPirkNumeris", "text"], ["dokSutObjPav", "text"],
    ["dokSutObjRusis", "text"], ["mcpvKodas", "text"], ["mcpvPav", "text"],
    ["pvKodas", "text"], ["pvPav", "text"], ["tiekKodas", "text"], ["tiekPav", "text"],
    ["tiekSbjPatikslinimas", "text"], ["tiekSalis", "text"], ["verte", "text"],
    ["dokSudarymoData", "date"], ["dokSutGaliojimoData", "date"],
    ["dokSutTipas", "smallint"], ["dokFormosTipas", "smallint"],
    ["faktineVerte", "text"], ["dokFaktSutIvykData", "date"],
];

const incoming = (laukai) => `SELECT * FROM unnest(${laukai
    .map(([, tipas], i) => `$${i + 1}::${tipas}[]`)
    .join(", ")}) AS x(${laukai.map(([r]) => `"${r}"`).join(", ")})`;

const STULPELIAI = [
    "dokId", "dokRegNr", "dokSysRegData", "dokSutNumeris", "pkPirkimoKodas",
    "dokPirkimoNumeris", "pirkimoBudoId", "objektoId", "objektoRusis", "cpvId",
    "pirkejoId", "tiekejoId", "tiekPavPatikslinimas", "valstybesId", "verte",
    "dokSudarymoData", "dokSutGaliojimoData", "dokSutTipas", "dokFormosTipas",
    "ppsZodSut", "faktineVerte", "dokFaktSutIvykData", "arVykdomasCvpIs",
    "arPreliminarus", "arSusijesSuTiriamaSituacija", "arSituacijaTipas1",
    "arSituacijaTipas2", "arSituacijaTipas3", "dokArTaikomi", "dokArNotNeededReason",
];

const ATVIRI_SQL = `
    WITH incoming AS (${incoming(LAUKAI)}),
    ${BENDRI_ZODYNAI.join(",\n    ")},
    ${vienoInsert("atviriPirkimoBudai", 'i."dokPirkimoBudas"')}
    INSERT INTO "vpmSutartys"."atviriDuomenys" (${STULPELIAI.map((s) => `"${s}"`).join(", ")})
    SELECT
        i."dokId", i."dokRegNr", i."dokSysRegData", i."dokSutNumeris", i."pkPirkimoKodas",
        i."dokPirkimoNumeris",
        ${vienoId("atviriPirkimoBudai", 'i."dokPirkimoBudas"')},
        ${OBJEKTO_ID}, nullif(btrim(i."dokSutObjRusis"), '')::smallint,
        ${CPV_ID}, ${PIRKEJO_ID}, ${TIEKEJO_ID},
        i."tiekPavPatikslinimas", ${VALSTYBES_ID}, "vpmSutartys".verte(i."verte"),
        i."dokSudarymoData", i."dokSutGaliojimoData", i."dokSutTipas", i."dokFormosTipas",
        i."ppsZodSut", "vpmSutartys".verte(i."faktineVerte"), i."dokFaktSutIvykData",
        i."arVykdomasCvpIs",
        i."arPreliminarus", i."arSusijesSuTiriamaSituacija", i."arSituacijaTipas1",
        i."arSituacijaTipas2", i."arSituacijaTipas3", i."dokArTaikomi",
        i."dokArNotNeededReason"
    FROM incoming i
    ON CONFLICT ("dokId") DO UPDATE SET
        ${STULPELIAI.filter((s) => s !== "dokId")
            .map((s) => `"${s}" = EXCLUDED."${s}"`)
            .join(",\n        ")}`;

const STULPELIAI_IMP = [
    "dokId", "dokSysRegData", "dokSutNumeris", "dokPirkNumeris", "objektoId",
    "objektoRusis", "cpvId", "pirkejoId", "tiekejoId", "tiekSbjPatikslinimas",
    "valstybesId", "verte", "dokSudarymoData", "dokSutGaliojimoData",
    "dokSutTipas", "dokFormosTipas", "faktineVerte", "dokFaktSutIvykData",
];

// `dokId` čia gali būti NULL (1,69 mln. istorinių eilučių), tad unikalumas
// tikrinamas tik ten, kur reikšmė yra – ON CONFLICT taikinys su ta pačia
// sąlyga, kaip daliniame indekse.
const ATVIRI_IMP_SQL = `
    WITH incoming AS (${incoming(LAUKAI_IMP)}),
    ${BENDRI_ZODYNAI.join(",\n    ")}
    INSERT INTO "vpmSutartys"."atviriDuomenysImp" (${STULPELIAI_IMP.map((s) => `"${s}"`).join(", ")})
    SELECT
        i."dokId", i."dokSysRegData", i."dokSutNumeris", i."dokPirkNumeris",
        ${OBJEKTO_ID}, nullif(btrim(i."dokSutObjRusis"), '')::smallint,
        ${CPV_ID}, ${PIRKEJO_ID}, ${TIEKEJO_ID},
        i."tiekSbjPatikslinimas", ${VALSTYBES_ID}, "vpmSutartys".verte(i."verte"),
        i."dokSudarymoData", i."dokSutGaliojimoData", i."dokSutTipas",
        i."dokFormosTipas", "vpmSutartys".verte(i."faktineVerte"), i."dokFaktSutIvykData"
    FROM incoming i
    ON CONFLICT ("dokId") WHERE "dokId" IS NOT NULL DO UPDATE SET
        ${STULPELIAI_IMP.filter((s) => s !== "dokId")
            .map((s) => `"${s}" = EXCLUDED."${s}"`)
            .join(",\n        ")}`;

const parametrai = (laukai, eilutes) =>
    laukai.map(([raktas]) => eilutes.map((e) => e[raktas] ?? null));

/** @param {Object[]} eilutes – normalizuotos naujojo rinkinio eilutės */
export async function irasytiAtvirusDuomenis(eilutes) {
    if (!eilutes.length) return 0;
    const { rowCount } = await postgres.query(ATVIRI_SQL, parametrai(LAUKAI, eilutes));
    return rowCount;
}

/** @param {Object[]} eilutes – normalizuotos ankstesniojo („Imp") rinkinio eilutės */
export async function irasytiAtvirusDuomenisImp(eilutes) {
    if (!eilutes.length) return 0;
    const { rowCount } = await postgres.query(ATVIRI_IMP_SQL, parametrai(LAUKAI_IMP, eilutes));
    return rowCount;
}

export { tuscia, arReiksme };
