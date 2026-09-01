import { postgres } from "../../postgres/postgres.js";
import {
    WINDOW_COUNT_SQL,
    splitWindowCount,
} from "../../utils/windowCount.js";
import pazeidimaiArticles from "./pazeidimaiArticles.json" with { type: "json" };

const articleMap = new Map(pazeidimaiArticles.map((a) => [a.straipsnis, a]));

export async function getVdiPazeidimai(jarKodas, options = {}) {
    let limit = options.limit || 10_000_000;
    if (options.limit === "max") {
        limit = 10_000_000;
    }

    const res = await postgres.query(
        `SELECT *, ${WINDOW_COUNT_SQL} FROM vdi."pazeidimaiPilni" WHERE "jarKodas" = $1::integer ORDER BY "straipsnis" LIMIT $2`,
        [jarKodas, limit],
    );
    const { rows: pazeidimai, viso } = splitWindowCount(res.rows);

    const rows = pazeidimai.map((row) => {
        const article = articleMap.get(row.straipsnis) ?? {};
        return {
            ...row,
            pavadinimas: article.pavadinimas ?? null,
            teisesAktas: article.teisesAktas ?? null,
        };
    });

    return {
        limit,
        count: viso,
        rows,
    };
}
