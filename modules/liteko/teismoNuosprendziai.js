import { postgres } from "../../postgres/postgres.js";

export async function gautiTeismoNuosprendzius(jarKodas, options = {}) {
    let useLimit = false;
    let limit = 5;
    if (options.limit) {
        limit = parseInt(options.limit, 10);
        useLimit = true;
    }

    // Run count and fetch in parallel
    const [countResult, rowsResult] = await Promise.all([
        postgres.query(
            `SELECT "count" AS total
                 FROM "bylosDalyviaiCounts"
                 WHERE "jarKodas" = $1::text;`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT b.*, bd.*
             FROM "bylos" b
             JOIN "bylosDalyviai" bd ON bd."bylosId" = b.id
             WHERE bd."kodas" = $1::text
             ORDER BY bd."data" DESC
             ${useLimit ? "LIMIT $2" : ""}`,
            useLimit ? [jarKodas, limit] : [jarKodas],
        ),
    ]);

    return {
        limit: useLimit ? limit : "max",
        rows: countResult.rows[0]?.total ?? 0, // total matching rows
        nuosprendziai: rowsResult.rows.map((nuosprendis) => ({
            ...nuosprendis,
            // Capitalize first letter of bylojeKaip
            bylojeKaip: nuosprendis.bylojeKaip
                ? nuosprendis.bylojeKaip.charAt(0).toUpperCase() +
                  nuosprendis.bylojeKaip.slice(1)
                : "",
            bylosRusis: nuosprendis.bylosRusis
                ? nuosprendis.bylosRusis.charAt(0).toUpperCase() +
                  nuosprendis.bylosRusis.slice(1)
                : "",
        })),
    };
}
