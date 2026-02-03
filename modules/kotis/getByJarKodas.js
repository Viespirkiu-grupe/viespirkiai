import { postgres } from "../../postgres/postgres.js";

export async function rastiKotisPagalGavejoKoda(gavejoKodas, options = {}) {
    let limit = options.limit || 10_000_000;
    if (options.limit === "max") limit = 10_000_000;

    const [kotisRes, kotisCountRes] = await Promise.all([
        postgres.query(
            `SELECT * FROM kotis WHERE "gavejoKodas" = $1 ORDER BY "suteikimoData" DESC LIMIT $2;`,
            [gavejoKodas, limit],
        ),
        postgres.query(
            `SELECT row_count FROM "kotisCounts" WHERE "gavejoKodas" = $1;`,
            [gavejoKodas],
        ),
    ]);

    const kotisCount = kotisCountRes.rows[0]?.row_count ?? 0;

    return {
        limit,
        count: Number(kotisCount),
        rows: kotisRes.rows, // return entire row as-is
    };
}
