import { postgres } from "../../postgres/postgres.js";

export async function gautiRegitrosDuomenis(req, jarKodas) {
    // Determine the limit from query parameter, default to 25
    let limit = parseInt(req.query.transportoPriemonesLimit, 10) || 5;

    // If limit is "max" (or exceeds 100000), remove LIMIT in SQL
    const useLimit = !(
        req.query.transportoPriemonesLimit === "max" || limit > 100000
    );

    // Run count and fetch in parallel
    const [transportoPriemonesCountResult, transportoPriemonesRows] =
        await Promise.all([
            postgres.query(
                `SELECT COUNT(*) AS total
           FROM regitra
           WHERE "jarKodas" = $1;`,
                [jarKodas],
            ),
            postgres.query(
                `SELECT *
           FROM regitra
           WHERE "jarKodas" = $1
           ORDER BY "pirmosiosRegistracijosData" ASC
           ${useLimit ? "LIMIT $2" : ""};`,
                useLimit ? [jarKodas, limit] : [jarKodas],
            ),
        ]);

    return {
        limit: useLimit ? limit : "max",
        rows: parseInt(transportoPriemonesCountResult.rows[0].total, 10), // total matching rows
        transportoPriemones: transportoPriemonesRows.rows, // limited rows
    };
}
