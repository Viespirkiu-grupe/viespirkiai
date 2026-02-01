import { postgres } from "../../postgres/postgres.js";

export async function gautiSutarciuDuomenisPagalJarKoda(
    jarKodas,
    options = {},
) {
    let limit = 100_000_000;
    if (options.limit) {
        limit = parseInt(options.limit, 10);
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
                    "metai" AS "year",
                    ROUND(SUM("total")::numeric, 2) AS total
                FROM public."sutartysSumosMetaiPirkejas"
                WHERE "perkanciosiosOrganizacijosKodas" = $1
                  AND "tipas" <> 'SP'
                  AND "metai" >= 2000
                  AND "metai" <= EXTRACT(YEAR FROM CURRENT_DATE) + 1
                GROUP BY "metai"
                ORDER BY "metai" ASC;
      `,
                [jarKodas],
            ),
            client.query(
                `
                SELECT
                    "metai" AS "year",
                    ROUND(SUM("total")::numeric, 2) AS total
                FROM public."sutartysSumosMetaiTiekejas"
                WHERE "tiekejoKodas" = $1
                  AND "tipas" <> 'SP'
                  AND "metai" >= 2000
                  AND "metai" <= EXTRACT(YEAR FROM CURRENT_DATE) + 1
                GROUP BY "metai"
                ORDER BY "metai" ASC;
      `,
                [jarKodas],
            ),
            client.query(
                `
                SELECT
                    agg."tiekejoKodas" AS "jarKodas",
                    COALESCE(j."pavadinimas", 'Nežinomas') AS "pavadinimas",
                    agg."suma" AS "total",
                    agg."kiekis" AS "count"
                FROM (
                    SELECT
                        "tiekejoKodas",
                        "suma",
                        "kiekis"
                    FROM "sutartysSaliuSumos"
                    WHERE "pirkejoKodas" = $1
                    ORDER BY "suma" DESC
                    LIMIT ${Number(limit)}
                ) agg
                LEFT JOIN public."jarCsv" j
                    ON j."jarKodas"::text = agg."tiekejoKodas";
                `,
                [jarKodas],
            ),
            client.query(
                `
                SELECT
                    agg."pirkejoKodas" AS "jarKodas",
                    COALESCE(j."pavadinimas", 'Nežinomas') AS "pavadinimas",
                    agg."suma" AS "total",
                    agg."kiekis" AS "count"
                FROM (
                    SELECT
                        "pirkejoKodas",
                        "suma",
                        "kiekis"
                    FROM "sutartysSaliuSumos"
                    WHERE "tiekejoKodas" = $1
                    ORDER BY "suma" DESC
                    LIMIT ${Number(limit)}
                ) agg
                LEFT JOIN public."jarCsv" j
                    ON j."jarKodas"::text = agg."pirkejoKodas";
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
