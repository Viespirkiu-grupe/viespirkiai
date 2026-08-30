import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { acquireSessionLock } from "../../postgres/sessionLock.js";
import {
    JAR_ADDRESS_JOINS,
    JAR_ADDRESS_SQL,
    JAR_LOCATION_SQL,
} from "./jarReadSql.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

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

export async function upsertDictionaries(client) {
    await client.query(`
        INSERT INTO public."juridiniaiSavivaldybesPavadinimai" ("pavadinimas")
        SELECT DISTINCT "pavadinimas"
        FROM "adresuRegistras"."savivaldybes"
        ON CONFLICT ("pavadinimas") DO NOTHING
    `);

    await client.query(`
        INSERT INTO public."juridiniaiApskritysPavadinimai" ("pavadinimas")
        SELECT DISTINCT "pavadinimas"
        FROM "adresuRegistras"."apskritys"
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
        SELECT "kodas", "pavadinimas"
        FROM public."jarStatusai"
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

export function buildJuridiniaiUpsertSql(batchSql, resultSql) {
    return `
    WITH batch AS MATERIALIZED (
        ${batchSql}
    ),
    source AS MATERIALIZED (
        SELECT
            j."jarKodas",
            j."pavadinimas",
            ${JAR_ADDRESS_SQL} AS "adresas",
            j."formosKodas",
            j."statusoKodas",
            j."isregistravimoData" IS NOT NULL AS "isregistruotas",
            j."registravimoData",
            j."isregistravimoData",
            sav_dict."id" AS "savivaldybeId",
            aps_dict."id" AS "apskritisId",
            evrk_dict."kodas" AS "evrkKodas",
            sodra."darbuotojai",
            sodra."vidutinisAtlyginimas",
            vmi."suma" AS "vmiMokesciai",
            kapitalas."kapitalas" AS "istatinisKapitalas",
            COALESCE(sutartys."pirkimai", 0)::bigint AS "pirkimuKiekis",
            COALESCE(NULLIF(sutartys."pirkimuSuma", 'NaN'::numeric), 0)
                AS "pirkimuSuma",
            COALESCE(sutartys."pardavimai", 0)::bigint AS "pardavimuKiekis",
            COALESCE(NULLIF(sutartys."pardavimuSuma", 'NaN'::numeric), 0)
                AS "pardavimuSuma",
            COALESCE(bylos."count", 0)::bigint AS "byluKiekis",
            vdi."count"::bigint AS "vdiPazeidimuKiekis",
            COALESCE(domenai."domainCount", 0)::bigint AS "domenuKiekis",
            ${JAR_LOCATION_SQL} AS "location"
        FROM batch j
        -- Bendram fragmentui reikia vienodo pagrindinės lentelės aliaso.
        LEFT JOIN public."jarAsmenys" jar_person
            ON jar_person."jarKodas" = j."jarKodas"
        ${JAR_ADDRESS_JOINS}
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
            WHERE sm."jarKodas" = j."jarKodas"
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
            WHERE m."jarKodas" = j."jarKodas"::text
            ORDER BY m."metai" DESC, m."menuo" DESC, m."duomenuData" DESC
            LIMIT 1
        ) vmi ON true
        LEFT JOIN LATERAL (
            SELECT k."kapitalas"
            FROM public."jarKapitalas" k
            WHERE k."jarKodas" = j."jarKodas"
            ORDER BY k."kapitalasNuo" DESC, k."duomenuData" DESC
            LIMIT 1
        ) kapitalas ON true
        LEFT JOIN public."vpmSutartysSumos" sutartys
            ON sutartys."saliesKodas" = j."jarKodas"::text
        LEFT JOIN liteko."dalyviuCounts" bylos
            ON bylos."jarKodas" = j."jarKodas"::text
        LEFT JOIN LATERAL (
            SELECT count(*) AS "count"
            FROM vdi.pazeidimai v
            JOIN vdi.subjektai s ON s.id = v."subjektoId"
            WHERE s."jarKodas" = j."jarKodas"::integer
        ) vdi ON true
        LEFT JOIN domenai.counts domenai
            ON domenai."savininkoKodas" = j."jarKodas"::text
        LEFT JOIN public."juridiniaiSavivaldybesPavadinimai" sav_dict
            ON sav_dict."pavadinimas" = jar_municipality."pavadinimas"
        LEFT JOIN public."juridiniaiApskritysPavadinimai" aps_dict
            ON aps_dict."pavadinimas" = jar_county."pavadinimas"
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
    ${resultSql}
`;
}

export const UPSERT_BATCH_SQL = buildJuridiniaiUpsertSql(
    `SELECT jar_person.*
     FROM public."jarAsmenys" jar_person
     WHERE jar_person."jarKodas" > $1
     ORDER BY jar_person."jarKodas"
     LIMIT $2`,
    `SELECT
        (SELECT max("jarKodas") FROM batch) AS "lastJarKodas",
        (SELECT count(*)::integer FROM batch) AS "scanned",
        (SELECT count(*)::integer FROM upserted) AS "changed"`,
);

export async function backfillJuridiniai({ batchSize = DEFAULT_BATCH_SIZE } = {}) {
    // Lock'as – atskiroje tiesioginėje jungtyje, nes jis gyvena per visą
    // backfill'ą, t. y. per daugybę transakcijų (žr. postgres/sessionLock.js).
    const lock = await acquireSessionLock(LOCK_KEY);
    if (!lock) {
        throw new Error("Kitas juridinių asmenų backfill procesas jau veikia");
    }

    const client = await postgres.connect();
    let lastJarKodas = 0;
    let scannedTotal = 0;
    let changedTotal = 0;

    try {
        await client.query("BEGIN");
        await upsertDictionaries(client);
        await client.query("COMMIT");
        signalWork(WORK_SIGNALS.JURIDINIAI_INDEX_READY, {
            source: "juridiniai-backfill-dictionaries",
        });

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

            if (changed > 0) {
                signalWork(WORK_SIGNALS.JURIDINIAI_INDEX_READY, {
                    source: "juridiniai-backfill",
                    count: changed,
                });
            }

            lastJarKodas = result.lastJarKodas;
            scannedTotal += scanned;
            changedTotal += changed;
            console.log(
                `juridiniai: peržiūrėta ${scannedTotal}, pakeista ${changedTotal}, ` +
                `paskutinis JAR ${lastJarKodas}`,
            );
        }

        await client.query("BEGIN");
        const removed = await client.query(
            `DELETE FROM public."juridiniai" target
             WHERE target."jarKodas" ~ '^[0-9]{9}$'
               AND NOT EXISTS (
                   SELECT 1 FROM public."jarAsmenys" source
                   WHERE source."jarKodas"::text = target."jarKodas"
               )`,
        );
        await client.query("COMMIT");
        changedTotal += removed.rowCount;

        return { scanned: scannedTotal, changed: changedTotal };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
        await lock.release();
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
