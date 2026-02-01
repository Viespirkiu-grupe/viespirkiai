import { postgres } from "../../postgres/postgres.js";

export async function gautiJadisDalyvius(jarId) {
    let jadis = {};

    if (jarId) {
        const jadisRes = await postgres.query(
            `SELECT *
               FROM "jadis"
               WHERE "jarId" = $1`,
            [jarId],
        );

        if (jadisRes.rows.length > 0) {
            jadis = jadisRes.rows[0];
        }
    }

    delete jadis["jarId"];
    delete jadis["formaId"];
    delete jadis["statusasId"];

    return jadis;
}
