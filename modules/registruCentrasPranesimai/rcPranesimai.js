import { postgres } from "../../postgres/postgres.js";

export async function gautiRcPranesimusPagalJarKoda(jarKodas, options = {}) {
    let useLimit = false;
    let limit = 5;
    if (options.limit) {
        limit = parseInt(options.limit, 10);
        useLimit = true;
    }

    // Run count and fetch in parallel
    var [rcPranesimaiCountResult, rcPranesimaiResult] = await Promise.all([
        postgres.query(
            `SELECT COUNT(*)
            FROM "rcInformaciniaiLeidiniaiPranesimai"
            WHERE "jarKodas" = $1`,
            [jarKodas],
        ),
        postgres.query(
            `SELECT *
            FROM "rcInformaciniaiLeidiniaiPranesimai"
            WHERE "jarKodas" = $1
            ORDER BY "leidinioData" DESC
           ${useLimit ? "LIMIT $2" : ""};`,
            useLimit ? [jarKodas, limit] : [jarKodas],
        ),
    ]);

    return {
        limit: useLimit ? limit : "max",
        rows: Number(rcPranesimaiCountResult.rows[0]?.count) ?? 0,
        pranesimai: rcPranesimaiResult.rows,
    };
}
