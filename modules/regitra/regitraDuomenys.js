import { postgres } from "../../postgres/postgres.js";

export async function gautiRegitrosDuomenis(jarKodas, options = {}) {
    let useLimit = false;
    let limit = 5;
    if (options.limit) {
        limit = parseInt(options.limit, 10);
        useLimit = true;
    }

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
