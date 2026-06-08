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
                 FROM "teismoNuosprendziaiDalyviaiCounts"
                 WHERE "jarKodas" = $1::text;`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT n.*, d.*
             FROM "teismoNuosprendziai" n
             JOIN "teismoNuosprendziaiDalyviai" d ON d."nuosprendzioId" = n.id
             WHERE d."kodas" = $1::text
             ORDER BY d."data" DESC
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
