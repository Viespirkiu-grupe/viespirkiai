import { postgres } from "../../postgres/postgres.js";

const UPSERT_SQL = `
WITH incoming AS MATERIALIZED (
    SELECT
        (doc->>'kodas')::integer AS kodas,
        (NULLIF(doc->>'jarKodas', ''))::integer AS "jarKodas",
        NULLIF(doc->>'pavadinimas', '') AS pavadinimas,
        NULLIF(doc->>'savivaldybe', '') AS savivaldybe,
        NULLIF(doc->>'ekonominesVeiklosKodas', '') AS "evrkKodas",
        NULLIF(doc->>'ekonominesVeiklosKodasEvrk', '') AS "evrkKodasEvrk",
        NULLIF(doc->>'ekonominesVeiklosPavadinimas', '') AS "evrkPavadinimas",
        (doc->>'data')::date AS data,
        (doc->>'vidutinisAtlyginimas')::double precision AS "vidutinisAtlyginimas",
        COALESCE((doc->>'draustieji')::integer, 0) AS draustieji,
        (doc->>'vidutinisAtlyginimas2')::double precision AS "vidutinisAtlyginimas2",
        COALESCE((doc->>'draustieji2')::integer, 0) AS draustieji2,
        (doc->>'imokuSuma')::double precision AS "imokuSuma"
    FROM jsonb_array_elements($1::jsonb) AS row(doc)
),
inserted_import AS (
    INSERT INTO public."sodraMonthlyImportai" ("importFile")
    VALUES ($2)
    ON CONFLICT ("importFile") DO NOTHING
    RETURNING id
),
target_import AS MATERIALIZED (
    SELECT id
    FROM public."sodraMonthlyImportai"
    WHERE "importFile" = $2
    UNION ALL
    SELECT id FROM inserted_import
    LIMIT 1
),
names_to_insert AS MATERIALIZED (
    SELECT DISTINCT pavadinimas
    FROM incoming
    WHERE pavadinimas IS NOT NULL
),
inserted_names AS (
    INSERT INTO public."sodraMonthlyPavadinimai" (pavadinimas)
    SELECT pavadinimas FROM names_to_insert
    ON CONFLICT (pavadinimas) DO NOTHING
    RETURNING id, pavadinimas
),
municipalities_to_insert AS MATERIALIZED (
    SELECT DISTINCT savivaldybe AS pavadinimas
    FROM incoming
    WHERE savivaldybe IS NOT NULL
),
inserted_municipalities AS (
    INSERT INTO public."sodraMonthlySavivaldybes" (pavadinimas)
    SELECT pavadinimas FROM municipalities_to_insert
    ON CONFLICT (pavadinimas) DO NOTHING
    RETURNING id, pavadinimas
),
evrk_to_insert AS MATERIALIZED (
    SELECT DISTINCT
        "evrkKodas" AS kodas,
        "evrkKodasEvrk" AS "kodasEvrk",
        "evrkPavadinimas" AS pavadinimas
    FROM incoming i
    WHERE ("evrkKodas" IS NOT NULL
           OR "evrkKodasEvrk" IS NOT NULL
           OR "evrkPavadinimas" IS NOT NULL)
      AND NOT EXISTS (
          SELECT 1
          FROM public."sodraMonthlyEvrk" existing
          WHERE existing.kodas IS NOT DISTINCT FROM i."evrkKodas"
            AND existing."kodasEvrk" IS NOT DISTINCT FROM i."evrkKodasEvrk"
            AND existing.pavadinimas IS NOT DISTINCT FROM i."evrkPavadinimas"
      )
),
inserted_evrk AS (
    INSERT INTO public."sodraMonthlyEvrk" (kodas, "kodasEvrk", pavadinimas)
    SELECT kodas, "kodasEvrk", pavadinimas FROM evrk_to_insert
    ON CONFLICT (kodas, "kodasEvrk", pavadinimas) DO NOTHING
    RETURNING id, kodas, "kodasEvrk", pavadinimas
),
monthly_upsert AS (
    INSERT INTO public."sodraMonthly" (
        kodas,
        "jarKodas",
        data,
        "pavadinimasId",
        "savivaldybeId",
        "evrkId",
        "vidutinisAtlyginimas",
        draustieji,
        "vidutinisAtlyginimas2",
        draustieji2,
        "imokuSuma",
        "importoId"
    )
    SELECT
        i.kodas,
        i."jarKodas",
        i.data,
        (
            SELECT id FROM public."sodraMonthlyPavadinimai"
            WHERE pavadinimas = i.pavadinimas
            UNION ALL
            SELECT id FROM inserted_names WHERE pavadinimas = i.pavadinimas
            LIMIT 1
        ),
        (
            SELECT id FROM public."sodraMonthlySavivaldybes"
            WHERE pavadinimas = i.savivaldybe
            UNION ALL
            SELECT id FROM inserted_municipalities
            WHERE pavadinimas = i.savivaldybe
            LIMIT 1
        ),
        CASE
            WHEN i."evrkKodas" IS NULL
             AND i."evrkKodasEvrk" IS NULL
             AND i."evrkPavadinimas" IS NULL
            THEN NULL
            ELSE (
                SELECT id
                FROM public."sodraMonthlyEvrk"
                WHERE kodas IS NOT DISTINCT FROM i."evrkKodas"
                  AND "kodasEvrk" IS NOT DISTINCT FROM i."evrkKodasEvrk"
                  AND pavadinimas IS NOT DISTINCT FROM i."evrkPavadinimas"
                UNION ALL
                SELECT id FROM inserted_evrk
                WHERE kodas IS NOT DISTINCT FROM i."evrkKodas"
                  AND "kodasEvrk" IS NOT DISTINCT FROM i."evrkKodasEvrk"
                  AND pavadinimas IS NOT DISTINCT FROM i."evrkPavadinimas"
                LIMIT 1
            )
        END,
        i."vidutinisAtlyginimas",
        i.draustieji,
        i."vidutinisAtlyginimas2",
        i.draustieji2,
        i."imokuSuma",
        import_row.id
    FROM incoming i
    CROSS JOIN target_import import_row
    ON CONFLICT (kodas, data) DO UPDATE SET
        "jarKodas" = EXCLUDED."jarKodas",
        "pavadinimasId" = EXCLUDED."pavadinimasId",
        "savivaldybeId" = EXCLUDED."savivaldybeId",
        "evrkId" = EXCLUDED."evrkId",
        "vidutinisAtlyginimas" = EXCLUDED."vidutinisAtlyginimas",
        draustieji = EXCLUDED.draustieji,
        "vidutinisAtlyginimas2" = EXCLUDED."vidutinisAtlyginimas2",
        draustieji2 = EXCLUDED.draustieji2,
        "imokuSuma" = EXCLUDED."imokuSuma",
        "importoId" = EXCLUDED."importoId"
    WHERE ROW(
        "sodraMonthly"."jarKodas", "sodraMonthly"."evrkId",
        "sodraMonthly"."vidutinisAtlyginimas", "sodraMonthly".draustieji,
        "sodraMonthly"."vidutinisAtlyginimas2", "sodraMonthly".draustieji2
    ) IS DISTINCT FROM ROW(
        EXCLUDED."jarKodas", EXCLUDED."evrkId",
        EXCLUDED."vidutinisAtlyginimas", EXCLUDED.draustieji,
        EXCLUDED."vidutinisAtlyginimas2", EXCLUDED.draustieji2
    )
    RETURNING id
)
SELECT count(*)::integer AS written FROM monthly_upsert;
`;

/** Upsert one parsed CSV batch into the normalized monthly Sodra tables. */
export async function upsertSodraMonthly(rows, importFile, db = postgres) {
    if (rows.length === 0) return 0;

    const result = await db.query(UPSERT_SQL, [JSON.stringify(rows), importFile]);
    return result.rows[0].written;
}

export { UPSERT_SQL };
