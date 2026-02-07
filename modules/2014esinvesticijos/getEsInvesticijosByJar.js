import { postgres } from "../../postgres/postgres.js";

export async function getEsInvesticijosByJar(jarKodas, options = {}) {
    let limit = options.limit || 10_000_000;
    if (options.limit == "max") {
        limit = 10_000_000;
    }

    let [esInvesticijosRes, esInvesticijosCountRes] = await Promise.all([
        postgres.query(
            `SELECT * FROM "2014Esinvesticijos" WHERE "pareiskejasJarKodas" = $1 ORDER BY "pabaigosData" DESC LIMIT $2;`,
            [jarKodas, limit],
        ),
        postgres.query(
            `SELECT COUNT(*) FROM "2014Esinvesticijos" WHERE "pareiskejasJarKodas" = $1;`,
            [jarKodas],
        ),
    ]);

    return {
        limit,
        count: parseInt(esInvesticijosCountRes.rows[0].count, 10),
        rows: esInvesticijosRes.rows,
    };
}
