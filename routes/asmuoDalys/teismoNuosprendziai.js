import { postgres } from "../../postgres/postgres.js";

export async function gautiTeismoNuosprendzius(req, jarKodas) {
    // Determine the limit from query parameter, default to 25
    let teismoLimit = parseInt(req.query.teismoNuosprendziaiLimit, 10) || 10;
    const teismoUseLimit = !(req.query.teismoNuosprendziaiLimit === "max");

    // Run count and fetch in parallel
    const [countResult, rowsResult] = await Promise.all([
        postgres.query(
            `SELECT COUNT(*) AS total
            FROM "bylosDalyviai"
            WHERE "kodas" = $1::text;`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT b.*, bd.*
             FROM "bylos" b
             JOIN "bylosDalyviai" bd ON bd."bylosId" = b.id
             WHERE bd."kodas" = $1::text
             ORDER BY bd."data" DESC
             ${teismoUseLimit ? "LIMIT $2" : ""}`,
            teismoUseLimit ? [jarKodas, teismoLimit] : [jarKodas],
        ),
    ]);

    return {
        limit: teismoUseLimit ? teismoLimit : "max",
        rows: parseInt(countResult.rows[0].total, 10), // total matching rows
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
