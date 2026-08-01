import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";

const DEFAULT_BATCH_SIZE = 5_000;
const LOCK_KEY = "juridiniai-backfill";

function parseBatchSize(argv) {
    const inline = argv.find((arg) => arg.startsWith("--batch-size="));
    const separateAt = argv.indexOf("--batch-size");
    const raw = inline?.slice("--batch-size=".length) ??
        (separateAt >= 0 ? argv[separateAt + 1] : DEFAULT_BATCH_SIZE);
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 50_000) {
        throw new Error("--batch-size turi būti sveikasis skaičius nuo 1 iki 50000");
    }
    return value;
}

async function upsertDictionaries(client) {
    await client.query(`
        INSERT INTO public."juridiniaiSavivaldybesPavadinimai" ("pavadinimas")
        SELECT DISTINCT "pavadinimas"
        FROM public."arSavivaldybes"
        ON CONFLICT ("pavadinimas") DO NOTHING
    `);

    await client.query(`
        INSERT INTO public."juridiniaiApskritysPavadinimai" ("pavadinimas")
        SELECT DISTINCT "pavadinimas"
        FROM public."arApskritys"
        ON CONFLICT ("pavadinimas") DO NOTHING
    `);

    await client.query(`
        INSERT INTO public."juridiniaiFormos" ("kodas", "pavadinimas", "viesasis")
        SELECT "kodas", "pavadinimas", "tipas" = 'Viešasis'
        FROM public."jarFormos"
        ON CONFLICT ("kodas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas",
            "viesasis" = EXCLUDED."viesasis"
        WHERE ROW(
            "juridiniaiFormos"."pavadinimas",
            "juridiniaiFormos"."viesasis"
        ) IS DISTINCT FROM ROW(
            EXCLUDED."pavadinimas",
            EXCLUDED."viesasis"
        )
    `);

    await client.query(`
        INSERT INTO public."juridiniaiStatusai" ("kodas", "pavadinimas")
        SELECT DISTINCT ON ("statusoKodas")
            "statusoKodas", "statusoPavadinimas"
        FROM public."jarCsv"
        ORDER BY "statusoKodas", "duomenuData" DESC
        ON CONFLICT ("kodas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas"
        WHERE "juridiniaiStatusai"."pavadinimas"
            IS DISTINCT FROM EXCLUDED."pavadinimas"
    `);

    await client.query(`
        INSERT INTO public."juridiniaiEvrk" ("kodas", "skyrius", "pavadinimas")
        SELECT DISTINCT ON ("kodas")
            "kodas", left("kodas", 2), COALESCE("pavadinimas", "kodas")
        FROM public."sodraMonthlyEvrk"
        WHERE "kodas" IS NOT NULL
        ORDER BY "kodas", ("pavadinimas" IS NULL), id DESC
        ON CONFLICT ("kodas") DO UPDATE SET
            "skyrius" = EXCLUDED."skyrius",
            "pavadinimas" = EXCLUDED."pavadinimas"
        WHERE ROW(
            "juridiniaiEvrk"."skyrius",
            "juridiniaiEvrk"."pavadinimas"
        ) IS DISTINCT FROM ROW(
            EXCLUDED."skyrius",
            EXCLUDED."pavadinimas"
        )
    `);

}

const UPSERT_BATCH_SQL = `
    WITH batch AS MATERIALIZED (
        SELECT j.*
        FROM public."jar" j
        WHERE j."jarKodas" > $1
        ORDER BY j."jarKodas"
        LIMIT $2
    ),
    source AS MATERIALIZED (
        SELECT
            j."jarKodas",
            j."pavadinimas",
            COALESCE(jc."adresas", ji."adresas", j."adresas") AS "adresas",
            jf."kodas" AS "formosKodas",
            jc."statusoKodas",
            j."isregistravimoData" IS NOT NULL AS "isregistruotas",
            j."registravimoData",
            j."isregistravimoData",
            sav_dict."id" AS "savivaldybeId",
            aps_dict."id" AS "apskritisId",
            evrk_dict."kodas" AS "evrkKodas",
            sodra."darbuotojai",
            sodra."vidutinisAtlyginimas",
            vmi."suma" AS "vmiMokesciai",
            kapitalas."reiksme" AS "istatinisKapitalas",
            COALESCE(sutartys."pirkimai", 0)::bigint AS "pirkimuKiekis",
            COALESCE(NULLIF(sutartys."pirkimuSuma", 'NaN'::numeric), 0)
                AS "pirkimuSuma",
            COALESCE(sutartys."pardavimai", 0)::bigint AS "pardavimuKiekis",
            COALESCE(NULLIF(sutartys."pardavimuSuma", 'NaN'::numeric), 0)
                AS "pardavimuSuma",
            COALESCE(bylos."count", 0)::bigint AS "byluKiekis",
            vdi."count"::bigint AS "vdiPazeidimuKiekis",
            COALESCE(domenai."domainCount", 0)::bigint AS "domenuKiekis",
            jc."location"
        FROM batch j
        LEFT JOIN public."jarCsv" jc
            ON jc."jarKodas"::text = j."jarKodas"
        LEFT JOIN public."jarCsvIsregistruoti" ji
            ON ji."jarKodas" = j."jarKodas"
        LEFT JOIN public."jarFormos" jf
            ON jf."_id" = j."formaId"
        LEFT JOIN LATERAL (
            SELECT
                sm."evrkId",
                sm.draustieji + sm.draustieji2 AS "darbuotojai",
                CASE
                    WHEN
                        CASE WHEN sm."vidutinisAtlyginimas" IS NULL
                            THEN 0 ELSE sm.draustieji END +
                        CASE WHEN sm."vidutinisAtlyginimas2" IS NULL
                            THEN 0 ELSE sm.draustieji2 END > 0
                    THEN (
                        COALESCE(sm."vidutinisAtlyginimas" * sm.draustieji, 0) +
                        COALESCE(sm."vidutinisAtlyginimas2" * sm.draustieji2, 0)
                    ) / (
                        CASE WHEN sm."vidutinisAtlyginimas" IS NULL
                            THEN 0 ELSE sm.draustieji END +
                        CASE WHEN sm."vidutinisAtlyginimas2" IS NULL
                            THEN 0 ELSE sm.draustieji2 END
                    )
                END AS "vidutinisAtlyginimas"
            FROM public."sodraMonthly" sm
            WHERE sm."jarKodas" = CASE
                WHEN j."jarKodas" ~ '^[0-9]+$' THEN j."jarKodas"::integer
            END
            ORDER BY sm."data" DESC
            LIMIT 1
        ) sodra ON true
        LEFT JOIN public."sodraMonthlyEvrk" evrk
            ON evrk."id" = sodra."evrkId"
        LEFT JOIN public."juridiniaiEvrk" evrk_dict
            ON evrk_dict."kodas" = evrk."kodas"
        LEFT JOIN LATERAL (
            SELECT m."suma"
            FROM public."mokesciai" m
            WHERE m."jarKodas" = j."jarKodas"
            ORDER BY m."metai" DESC, m."menuo" DESC, m."duomenuData" DESC
            LIMIT 1
        ) vmi ON true
        LEFT JOIN LATERAL (
            SELECT k."reiksme"
            FROM public."istatinisKapitalas" k
            WHERE k."jarId" = j."_id"
            ORDER BY k."data" DESC
            LIMIT 1
        ) kapitalas ON true
        LEFT JOIN public."vpmSutartysSumos" sutartys
            ON sutartys."saliesKodas" = j."jarKodas"
        LEFT JOIN public."teismoNuosprendziaiDalyviaiCounts" bylos
            ON bylos."jarKodas" = j."jarKodas"
        LEFT JOIN LATERAL (
            SELECT count(*) AS "count"
            FROM public."vdiPazeidimai" v
            WHERE v."jarKodas" = j."jarKodas"
        ) vdi ON true
        LEFT JOIN public."domenaiCounts" domenai
            ON domenai."savininkoKodas" = j."jarKodas"
        LEFT JOIN LATERAL (
            SELECT
                sav."pavadinimas" AS "savivaldybe",
                aps."pavadinimas" AS "apskritis"
            FROM public."arSavivaldybes" sav
            LEFT JOIN public."arApskritys" aps
                ON aps."kodas" = sav."apskritiesKodas"
            WHERE jc."location" IS NOT NULL
              AND ST_Covers(sav."geometrija", jc."location")
            LIMIT 1
        ) teritorija ON true
        LEFT JOIN public."juridiniaiSavivaldybesPavadinimai" sav_dict
            ON sav_dict."pavadinimas" = teritorija."savivaldybe"
        LEFT JOIN public."juridiniaiApskritysPavadinimai" aps_dict
            ON aps_dict."pavadinimas" = teritorija."apskritis"
    ),
    upserted AS (
        INSERT INTO public."juridiniai" AS old (
            "jarKodas", "pavadinimas", "adresas", "formosKodas",
            "statusoKodas", "isregistruotas", "registravimoData",
            "isregistravimoData", "savivaldybeId", "apskritisId",
            "evrkKodas", "darbuotojai", "vidutinisAtlyginimas",
            "vmiMokesciai", "istatinisKapitalas", "pirkimuKiekis",
            "pirkimuSuma", "pardavimuKiekis", "pardavimuSuma",
            "byluKiekis", "vdiPazeidimuKiekis", "domenuKiekis",
            "location", "atnaujinta"
        )
        SELECT
            "jarKodas", "pavadinimas", "adresas", "formosKodas",
            "statusoKodas", "isregistruotas", "registravimoData",
            "isregistravimoData", "savivaldybeId", "apskritisId",
            "evrkKodas", "darbuotojai", "vidutinisAtlyginimas",
            "vmiMokesciai", "istatinisKapitalas", "pirkimuKiekis",
            "pirkimuSuma", "pardavimuKiekis", "pardavimuSuma",
            "byluKiekis", "vdiPazeidimuKiekis", "domenuKiekis",
            "location", now()
        FROM source
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas",
            "adresas" = EXCLUDED."adresas",
            "formosKodas" = EXCLUDED."formosKodas",
            "statusoKodas" = EXCLUDED."statusoKodas",
            "isregistruotas" = EXCLUDED."isregistruotas",
            "registravimoData" = EXCLUDED."registravimoData",
            "isregistravimoData" = EXCLUDED."isregistravimoData",
            "savivaldybeId" = EXCLUDED."savivaldybeId",
            "apskritisId" = EXCLUDED."apskritisId",
            "evrkKodas" = EXCLUDED."evrkKodas",
            "darbuotojai" = EXCLUDED."darbuotojai",
            "vidutinisAtlyginimas" = EXCLUDED."vidutinisAtlyginimas",
            "vmiMokesciai" = EXCLUDED."vmiMokesciai",
            "istatinisKapitalas" = EXCLUDED."istatinisKapitalas",
            "pirkimuKiekis" = EXCLUDED."pirkimuKiekis",
            "pirkimuSuma" = EXCLUDED."pirkimuSuma",
            "pardavimuKiekis" = EXCLUDED."pardavimuKiekis",
            "pardavimuSuma" = EXCLUDED."pardavimuSuma",
            "byluKiekis" = EXCLUDED."byluKiekis",
            "vdiPazeidimuKiekis" = EXCLUDED."vdiPazeidimuKiekis",
            "domenuKiekis" = EXCLUDED."domenuKiekis",
            "location" = EXCLUDED."location",
            "atnaujinta" = EXCLUDED."atnaujinta"
        WHERE ROW(
            old."pavadinimas", old."adresas", old."formosKodas",
            old."statusoKodas", old."isregistruotas", old."registravimoData",
            old."isregistravimoData", old."savivaldybeId", old."apskritisId",
            old."evrkKodas", old."darbuotojai", old."vidutinisAtlyginimas",
            old."vmiMokesciai", old."istatinisKapitalas", old."pirkimuKiekis",
            old."pirkimuSuma", old."pardavimuKiekis", old."pardavimuSuma",
            old."byluKiekis", old."vdiPazeidimuKiekis", old."domenuKiekis",
            old."location"
        ) IS DISTINCT FROM ROW(
            EXCLUDED."pavadinimas", EXCLUDED."adresas", EXCLUDED."formosKodas",
            EXCLUDED."statusoKodas", EXCLUDED."isregistruotas",
            EXCLUDED."registravimoData", EXCLUDED."isregistravimoData",
            EXCLUDED."savivaldybeId", EXCLUDED."apskritisId",
            EXCLUDED."evrkKodas", EXCLUDED."darbuotojai",
            EXCLUDED."vidutinisAtlyginimas", EXCLUDED."vmiMokesciai",
            EXCLUDED."istatinisKapitalas", EXCLUDED."pirkimuKiekis",
            EXCLUDED."pirkimuSuma", EXCLUDED."pardavimuKiekis",
            EXCLUDED."pardavimuSuma", EXCLUDED."byluKiekis",
            EXCLUDED."vdiPazeidimuKiekis", EXCLUDED."domenuKiekis",
            EXCLUDED."location"
        )
        RETURNING 1
    )
    SELECT
        (SELECT max("jarKodas") FROM batch) AS "lastJarKodas",
        (SELECT count(*)::integer FROM batch) AS "scanned",
        (SELECT count(*)::integer FROM upserted) AS "changed"
`;

export async function backfillJuridiniai({ batchSize = DEFAULT_BATCH_SIZE } = {}) {
    const client = await postgres.connect();
    let lastJarKodas = "";
    let scannedTotal = 0;
    let changedTotal = 0;

    try {
        const lock = await client.query(
            "SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked",
            [LOCK_KEY],
        );
        if (!lock.rows[0]?.locked) {
            throw new Error("Kitas juridinių asmenų backfill procesas jau veikia");
        }

        await client.query("BEGIN");
        await upsertDictionaries(client);
        await client.query("COMMIT");

        while (true) {
            await client.query("BEGIN");
            const { rows } = await client.query(UPSERT_BATCH_SQL, [
                lastJarKodas,
                batchSize,
            ]);
            await client.query("COMMIT");

            const result = rows[0];
            const scanned = Number(result?.scanned ?? 0);
            const changed = Number(result?.changed ?? 0);
            if (!scanned) break;

            lastJarKodas = result.lastJarKodas;
            scannedTotal += scanned;
            changedTotal += changed;
            console.log(
                `juridiniai: peržiūrėta ${scannedTotal}, pakeista ${changedTotal}, ` +
                `paskutinis JAR ${lastJarKodas}`,
            );
        }

        return { scanned: scannedTotal, changed: changedTotal };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        await client.query(
            "SELECT pg_advisory_unlock(hashtext($1)::bigint)",
            [LOCK_KEY],
        ).catch(() => {});
        client.release();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const result = await backfillJuridiniai({
            batchSize: parseBatchSize(process.argv.slice(2)),
        });
        console.log(
            `Baigta: peržiūrėta ${result.scanned}, įterpta arba atnaujinta ${result.changed}`,
        );
    } finally {
        await postgres.end();
    }
}
