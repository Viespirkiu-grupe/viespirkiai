import { postgres } from "../../postgres/postgres.js";

export async function gautiSutarciuDuomenis(jarKodas) {
    const [
        { rows: pirkimaiKasMetus },
        { rows: tiekimaiKasMetus },
        { rows: topTiekejai },
        { rows: topPirkejai },
    ] = await Promise.all([
        postgres.query(
            `
            SELECT year, total
            FROM (
                SELECT
                    EXTRACT(YEAR FROM "sudarymoData")::int AS year,
                    ROUND(SUM("verte")::numeric, 2) AS total
                FROM sutartys
                WHERE "perkanciosiosOrganizacijosKodas" = $1
                  AND tipas <> 'SP'
                GROUP BY EXTRACT(YEAR FROM "sudarymoData")
            ) t
            WHERE year >= 2000
            ORDER BY year ASC;
      `,
            [jarKodas],
        ),
        postgres.query(
            `
            SELECT year, total
            FROM (
                SELECT
                    EXTRACT(YEAR FROM "sudarymoData")::int AS year,
                    ROUND(SUM("verte")::numeric, 2) AS total
                FROM sutartys
                WHERE "tiekejoKodas" = $1
                  AND tipas <> 'SP'
                GROUP BY EXTRACT(YEAR FROM "sudarymoData")
            ) t
            WHERE year >= 2000
            ORDER BY year ASC;
      `,
            [jarKodas],
        ),
        postgres.query(
            `
            WITH "top_sutartys" AS (
                SELECT "tiekejoKodas",
                       SUM("verte") AS "total"
                FROM "sutartys"
                WHERE "perkanciosiosOrganizacijosKodas" = $1
                  AND "tipas" <> 'SP'
                GROUP BY "tiekejoKodas"
                ORDER BY "total" DESC
                LIMIT 10
            )
            SELECT s."tiekejoKodas" AS "jarKodas",
                   COALESCE(j."pavadinimas", 'Nežinomas') AS "pavadinimas",
                   ROUND(s."total"::numeric, 2) AS "total"
            FROM "top_sutartys" s
            LEFT JOIN "jarCsv" j
                   ON j."jarKodas"::text = s."tiekejoKodas"
            ORDER BY s."total" DESC;
      `,
            [jarKodas],
        ),
        postgres.query(
            `
            WITH "top_sutartys" AS (
                SELECT "perkanciosiosOrganizacijosKodas",
                       SUM("verte") AS "total"
                FROM "sutartys"
                WHERE "tiekejoKodas" = $1
                  AND "tipas" <> 'SP'
                GROUP BY "perkanciosiosOrganizacijosKodas"
                ORDER BY "total" DESC
                LIMIT 10
            )
            SELECT s."perkanciosiosOrganizacijosKodas" AS "jarKodas",
                   COALESCE(j."pavadinimas", 'Nežinomas') AS "pavadinimas",
                   ROUND(s."total"::numeric, 2) AS "total"
            FROM "top_sutartys" s
            LEFT JOIN "jarCsv" j
              ON j."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
            ORDER BY s."total" DESC;
      `,
            [jarKodas],
        ),
    ]);

    return {
        pirkimaiKasMetus,
        tiekimaiKasMetus,
        topPirkejai,
        topTiekejai,
    };
}
