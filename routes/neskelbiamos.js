import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { postgres } from "../postgres/postgres.js";

const neskelbiamosDerybosRouter = express.Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;

/**
 * @param {{ limit?: string }} query
 * @returns {{ limit: number } | { error: string }}
 */
function parseLimit(query) {
    if (query.limit === "max") return { limit: MAX_LIMIT };
    const n = parseInt(query.limit);
    if (n > MAX_LIMIT)
        return {
            error: `Limitas per didelis. Maksimalus limitas yra ${MAX_LIMIT}.`,
        };
    if (n > 0) return { limit: n };
    return { limit: DEFAULT_LIMIT };
}

/**
 * @param {string} searchTerm
 * @returns {{ tsQueryFunc: string, cleanSearch: string }}
 */
function parseSearch(searchTerm) {
    const quoteMatch = searchTerm.match(/^"(.*)"$/);
    return {
        tsQueryFunc: quoteMatch ? "phraseto_tsquery" : "plainto_tsquery",
        cleanSearch: quoteMatch ? quoteMatch[1] : searchTerm,
    };
}

/**
 * @param {{ cleanSearch: string, tsQueryFunc: string, limit: number, skip: number }} params
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function queryNeskelbiamos({ cleanSearch, tsQueryFunc, limit, skip }) {
    const fileJoin = `
        LEFT JOIN public."failai" f
            ON replace(nd.link, 'https://eviesiejipirkimai.lt/', '') = f."saltinioId"
            AND f."parsiustas" = 1`;

    if (cleanSearch) {
        const [resultsRes, totalRes] = await Promise.all([
            postgres.query(
                `SELECT nd.*, f.id AS "failoId"
                 FROM public."neskelbiamosDerybos" nd ${fileJoin}
                 WHERE nd."search_index" @@ ${tsQueryFunc}('simple', $1)
                 LIMIT $2 OFFSET $3`,
                [cleanSearch, limit, skip],
            ),
            postgres.query(
                `SELECT COUNT(*) FROM public."neskelbiamosDerybos"
                 WHERE "search_index" @@ ${tsQueryFunc}('simple', $1)`,
                [cleanSearch],
            ),
        ]);
        return {
            rows: resultsRes.rows,
            total: parseInt(totalRes.rows[0].count, 10),
        };
    }

    const [resultsRes, totalRes] = await Promise.all([
        postgres.query(
            `SELECT nd.*, f.id AS "failoId"
             FROM public."neskelbiamosDerybos" nd ${fileJoin}
             ORDER BY nd.data DESC NULLS LAST
             LIMIT $1 OFFSET $2`,
            [limit, skip],
        ),
        postgres.query(`SELECT COUNT(*) FROM public."neskelbiamosDerybos"`),
    ]);
    return {
        rows: resultsRes.rows,
        total: parseInt(totalRes.rows[0].count, 10),
    };
}

/**
 * @param {string} text
 * @param {string} searchTerm
 * @param {number} [maxChars=250]
 * @param {number} [leading=25]
 * @returns {string}
 */
function makeExcerpt(text, searchTerm, maxChars = 250, leading = 25) {
    const isPhrase = /^".+"$/.test(searchTerm.trim());
    const inner = isPhrase ? searchTerm.trim().slice(1, -1) : null;
    const regex = isPhrase
        ? new RegExp(`(${inner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi")
        : new RegExp(
              `(${searchTerm
                  .split(/\s+/)
                  .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                  .join("|")})`,
              "gi",
          );

    const match = regex.exec(text);
    if (!match)
        return text.slice(0, maxChars) + (text.length > maxChars ? "..." : "");

    const start = Math.max(0, match.index - Math.floor(leading));
    const end = Math.min(text.length, start + maxChars);
    const snippet = text.slice(start, end);
    return (
        snippet.replace(regex, "<mark>$1</mark>") +
        (end < text.length ? "..." : "")
    );
}

/**
 * @param {{ rows: object[], total: number, limit: number, page: number, elapsed: number }} params
 * @returns {string}
 */
function buildNumberOfResults({ rows, total, limit, page, elapsed }) {
    const trukme = (elapsed / 1000).toFixed(2) + "s";
    const source = `<span class="inline">(${trukme}, PostgreSQL)</span>`;
    if (rows.length < total)
        return `Rodomi ${rows.length} iš ${Number(total).linksniuotiK(["rezultato", "rezultatų"])} ${source}`;
    return `${Number(total).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} ${source}`;
}

neskelbiamosDerybosRouter.get(
    "/neskelbiamos",
    cleanEmptyQueryParams,
    async (req, res) => {
        const startas = performance.now();

        const parsedLimit = parseLimit(req.query);
        if ("error" in parsedLimit)
            return res.status(400).send(parsedLimit.error);
        const { limit } = parsedLimit;

        const page = parseInt(req.query.page) || 1;
        const skip = (page - 1) * limit;

        const searchTerm = req.query.search || "";
        const { tsQueryFunc, cleanSearch } = searchTerm
            ? parseSearch(searchTerm)
            : { tsQueryFunc: "", cleanSearch: "" };

        const { rows, total } = await queryNeskelbiamos({
            cleanSearch,
            tsQueryFunc,
            limit,
            skip,
        });

        if (req.query.json) {
            return res.json({
                data: rows,
                currentPage: page,
                pageCount: Math.ceil(total / limit),
            });
        }

        res.render("neskelbiamos/index", {
            customHead: config.customHead,
            values: { search: searchTerm },
            data: rows,
            queryParams: `&search=${encodeURIComponent(searchTerm)}`,
            query: req.query,
            search: cleanSearch,
            numberOfResults: buildNumberOfResults({
                rows,
                total,
                limit,
                page,
                elapsed: performance.now() - startas,
            }),
            currentPage: page,
            pageCount: Math.ceil(total / limit),
            galimaEksportuoti: false,
            req,
            usedHiddenFields: false,
        });
    },
);

neskelbiamosDerybosRouter.get("/failai.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "",
        "Failų paieška",
        "",
        "viespirkiai.org/failai",
    );
});

neskelbiamosDerybosRouter.get("/neskelbiamos.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Neskelbiamų derybų paieška",
        "Viešpirkiai",
        "",
        "viespirkiai.org/neskelbiamos",
    );
});

export default neskelbiamosDerybosRouter;
