import { postgres } from "../../postgres/postgres.js";

export async function gautiDarboSkelbimus(jarKodas, options = {}) {
    let useLimit = false;
    let limit = 5;
    if (options.limit) {
        limit = parseInt(options.limit, 10);
        useLimit = true;
    }

    // Run count and fetch in parallel
    const [darboSkelbimaiCountResult, darboSkelbimaiRows] = await Promise.all([
        postgres.query(
            `SELECT "rowCount" AS total
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
