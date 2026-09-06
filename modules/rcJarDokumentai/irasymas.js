import { postgres } from "../../postgres/postgres.js";

/**
 * Vienas sakinys visam puslapiui: žodynų papildymas ir abi dokumentų eilučių
 * rūšys. Žodyno id imamas repo šablonu „esama eilutė UNION ALL ką tik įterpta",
 * nes CTE'os viena kitos įterptų eilučių nemato (žr.
 * modules/registruCentrasPranesimai/scrapeContent.js).
 *
 * Du INSERT'ai, nes eilutės skirstosi į dvi rūšis su skirtingais daliniais
 * unikaliais indeksais (žr. migrations/rcJar/001_pateiktiDokumentai.sql).
 * Aibės nesikerta, tad viename sakinyje jos viena kitai netrukdo.
 */
const INSERT_SQL = `
WITH i AS (
    SELECT * FROM jsonb_to_recordset($2::jsonb) AS x(
        "rcId" bigint,
        "tipas" text,
        "aprasymas" text,
        "dokumentoData" date,
        "gavimoData" date,
        "registravimoData" date,
        "lapuSkaicius" smallint
    )
),
ins_tipai AS (
    INSERT INTO "rcJar"."pateiktuDokumentuTipai" ("pavadinimas")
    SELECT DISTINCT i."tipas" FROM i
    ON CONFLICT ("pavadinimas") DO NOTHING
    RETURNING "id", "pavadinimas"
),
ins_aprasymai AS (
    INSERT INTO "rcJar"."pateiktuDokumentuAprasymai" ("pavadinimas")
    SELECT DISTINCT i."aprasymas" FROM i WHERE i."aprasymas" IS NOT NULL
    ON CONFLICT ("pavadinimas") DO NOTHING
    RETURNING "id", "pavadinimas"
),
eilutes AS (
    SELECT
        $1::integer AS "jarKodas",
        i."rcId",
        (SELECT "id" FROM "rcJar"."pateiktuDokumentuTipai" WHERE "pavadinimas" = i."tipas"
         UNION ALL SELECT "id" FROM ins_tipai WHERE "pavadinimas" = i."tipas"
         LIMIT 1) AS "tipasId",
        (SELECT "id" FROM "rcJar"."pateiktuDokumentuAprasymai" WHERE "pavadinimas" = i."aprasymas"
         UNION ALL SELECT "id" FROM ins_aprasymai WHERE "pavadinimas" = i."aprasymas"
         LIMIT 1) AS "aprasymasId",
        i."dokumentoData",
        i."gavimoData",
        i."registravimoData",
        i."lapuSkaicius"
    FROM i
),
su_id AS (
    INSERT INTO "rcJar"."pateiktiDokumentai" (
        "jarKodas", "rcId", "tipasId", "aprasymasId",
        "dokumentoData", "gavimoData", "registravimoData", "lapuSkaicius"
    )
    SELECT DISTINCT ON (e."rcId")
        e."jarKodas", e."rcId", e."tipasId", e."aprasymasId",
        e."dokumentoData", e."gavimoData", e."registravimoData", e."lapuSkaicius"
    FROM eilutes e
    WHERE e."rcId" IS NOT NULL
    ON CONFLICT ("rcId") WHERE "rcId" IS NOT NULL DO UPDATE SET
        "jarKodas" = EXCLUDED."jarKodas",
        "tipasId" = EXCLUDED."tipasId",
        "aprasymasId" = EXCLUDED."aprasymasId",
        "dokumentoData" = EXCLUDED."dokumentoData",
        "gavimoData" = EXCLUDED."gavimoData",
        "registravimoData" = EXCLUDED."registravimoData",
        "lapuSkaicius" = EXCLUDED."lapuSkaicius",
        "matyta" = now()
    RETURNING 1
),
be_id AS (
    INSERT INTO "rcJar"."pateiktiDokumentai" (
        "jarKodas", "rcId", "tipasId", "aprasymasId",
        "dokumentoData", "gavimoData", "registravimoData", "lapuSkaicius"
    )
    SELECT DISTINCT ON (
        e."tipasId", e."aprasymasId",
        e."dokumentoData", e."gavimoData", e."registravimoData")
        e."jarKodas", NULL::bigint, e."tipasId", e."aprasymasId",
        e."dokumentoData", e."gavimoData", e."registravimoData", e."lapuSkaicius"
    FROM eilutes e
    WHERE e."rcId" IS NULL
    ON CONFLICT ("jarKodas", "tipasId", "aprasymasId",
                 "dokumentoData", "gavimoData", "registravimoData")
        WHERE "rcId" IS NULL
        DO UPDATE SET
            "lapuSkaicius" = EXCLUDED."lapuSkaicius",
            "matyta" = now()
    RETURNING 1
)
SELECT
    (SELECT count(*)::integer FROM su_id) + (SELECT count(*)::integer FROM be_id) AS "irasyta"
`;

/**
 * Įrašo vieno juridinio asmens dok.php eilutes.
 *
 * @param {number} jarKodas
 * @param {import("./parse.js").PateiktasDokumentas[]} eilutes
 * @param {import("pg").Pool|import("pg").PoolClient} [db]
 * @returns {Promise<number>} kiek eilučių paliesta
 */
export async function irasytiPateiktusDokumentus(jarKodas, eilutes, db = postgres) {
    if (!eilutes.length) return 0;
    const rezultatas = await db.query(INSERT_SQL, [jarKodas, JSON.stringify(eilutes)]);
    return Number(rezultatas.rows[0]?.irasyta ?? 0);
}

export { INSERT_SQL };
