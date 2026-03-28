import { postgres } from "../../postgres/postgres.js";
import pazeidimaiArticles from "./pazeidimaiArticles.json" with { type: "json" };

const articleMap = new Map(pazeidimaiArticles.map((a) => [a.straipsnis, a]));

export async function getVdiPazeidimai(jarKodas, options = {}) {
    let limit = options.limit || 10_000_000;
    if (options.limit === "max") {
        limit = 10_000_000;
    }

    const [res, countRes] = await Promise.all([
        postgres.query(
            `SELECT * FROM "vdiPazeidimai" WHERE "jarKodas" = $1 ORDER BY "straipsnis" LIMIT $2`,
            [jarKodas, limit],
        ),
        postgres.query(
            `SELECT COUNT(*) FROM "vdiPazeidimai" WHERE "jarKodas" = $1`,
            [jarKodas],
        ),
    ]);

    const rows = res.rows.map((row) => {
        const article = articleMap.get(row.straipsnis) ?? {};
        return {
            ...row,
            pavadinimas: article.pavadinimas ?? null,
            teisesAktas: article.teisesAktas ?? null,
        };
    });

    return {
        limit,
        count: parseInt(countRes.rows[0].count),
        rows,
    };
}
