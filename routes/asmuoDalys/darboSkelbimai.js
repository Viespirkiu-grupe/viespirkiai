import { postgres } from "../../postgres/postgres.js";

export async function gautiDarboSkelbimus(req, jarKodas) {
    // Determine the limit from query parameter, default to 25
    let limit = parseInt(req.query.darboSkelbimaiLimit, 10) || 5;

    // If limit is "max" (or exceeds 100000), remove LIMIT in SQL
    const useLimit = !(
        req.query.darboSkelbimaiLimit === "max" || limit > 100000
    );

    // Run count and fetch in parallel
    const [darboSkelbimaiCountResult, darboSkelbimaiRows] = await Promise.all([
        postgres.query(
            `SELECT "count" AS total
               FROM "darboVietaCount"
               WHERE "jarKodas" = $1;`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT *
           FROM "darboVieta"
           WHERE "jar_kodas" = $1
           ORDER BY "ikelimo_data" DESC
           ${useLimit ? "LIMIT $2" : ""};`,
            useLimit ? [jarKodas, limit] : [jarKodas],
        ),
    ]);

    return {
        limit: useLimit ? limit : "max",
        rows: darboSkelbimaiCountResult.rows[0]?.total ?? 0,
        skelbimai: darboSkelbimaiRows.rows,
    };
}
