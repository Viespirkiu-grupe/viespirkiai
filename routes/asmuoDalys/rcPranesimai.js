import { postgres } from "../../postgres/postgres.js";

export async function gautiRcPranesimus(req, jarKodas) {
    // Determine the limit from query parameter, default to 3
    let limit = parseInt(req.query.rcPranesimaiLimit, 10) || 3;

    // If limit is "max" (or exceeds 100000), remove LIMIT in SQL
    const useLimit = !(req.query.rcPranesimaiLimit === "max" || limit > 100000);

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
