import { postgres } from "../../postgres/postgres.js";

export async function gautiSutarciuDuomenis(req, jarKodas) {
    let sutartysLimit = parseInt(req.query.sutartysLimit, 10) || 10;
    const sutartysUseLimit = !(req.query.sutartysLimit === "max");

    console.log(sutartysLimit, sutartysUseLimit);

    if (sutartysUseLimit == false) {
        sutartysLimit = 1000000;
    }

    const client = await postgres.connect();
    try {
        await client.query("SET enable_seqscan = off;");

        var [
            { rows: pirkimaiKasMetus },
            { rows: tiekimaiKasMetus },
            { rows: topTiekejai },
            { rows: topPirkejai },
        ] = await Promise.all([
            client.query(
                `
                SELECT
                  "year",
                  ROUND(SUM("total")::numeric, 2) AS total
                FROM public."sutartysSumosMetai"
                WHERE "perkanciosiosOrganizacijosKodas" = $1
                  AND "tipas" <> 'SP'
                  AND "year" >= 2000
                  AND "year" <= EXTRACT(YEAR FROM CURRENT_DATE) + 1
                GROUP BY "year"
                ORDER BY "year" ASC;
      `,
                [jarKodas],
            ),
            client.query(
                `
                SELECT
                  "year",
                  ROUND(SUM("total")::numeric, 2) AS total
                FROM public."sutartysSumosMetai"
                WHERE "tiekejoKodas" = $1
                  AND "tipas" <> 'SP'
                  AND "year" >= 2000
                  AND "year" <= EXTRACT(YEAR FROM CURRENT_DATE) + 1
                GROUP BY "year"
                ORDER BY "year" ASC;
      `,
                [jarKodas],
            ),
            client.query(
                `
                SELECT
                    s."tiekejoKodas" AS "jarKodas",
                    COALESCE(j."pavadinimas", 'Nežinomas') AS "pavadinimas",
                    ROUND(SUM(s."total")::numeric, 2) AS "total",
                    SUM(s."count")::numeric AS "count"
                FROM public."sutartysSumos" s
                LEFT JOIN public."jarCsv" j
                    ON j."jarKodas"::text = s."tiekejoKodas"
                WHERE s."perkanciosiosOrganizacijosKodas" = $1
                  AND s."tipas" <> 'SP'
                GROUP BY s."tiekejoKodas", j."pavadinimas"
                ORDER BY total DESC
                LIMIT ${Number(sutartysLimit)};
      `,
                [jarKodas],
            ),
            client.query(
                `
                SELECT
                    s."perkanciosiosOrganizacijosKodas" AS "jarKodas",
                    COALESCE(j."pavadinimas", 'Nežinomas') AS "pavadinimas",
                    ROUND(SUM(s."total")::numeric, 2) AS "total",
                    SUM(s."count")::numeric AS "count"
                FROM public."sutartysSumos" s
                LEFT JOIN public."jarCsv" j
                    ON j."jarKodas"::text = s."perkanciosiosOrganizacijosKodas"
                WHERE s."tiekejoKodas" = $1
                  AND s."tipas" <> 'SP'
                GROUP BY s."perkanciosiosOrganizacijosKodas", j."pavadinimas"
                ORDER BY total DESC
                LIMIT ${Number(sutartysLimit)};
      `,
                [jarKodas],
            ),
        ]);

        await client.query("SET enable_seqscan = on;");
    } catch (e) {
        console.error(e);
    } finally {
        client.release();
    }

    return {
        pirkimaiKasMetus,
        tiekimaiKasMetus,
        topPirkejai,
        topTiekejai,
    };
}
