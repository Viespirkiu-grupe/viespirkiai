import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { postgres } from "../postgres/postgres.js";

const nepatikimiIrMelagiaiRouter = express.Router();

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

const NEPATIKIMAS_COLS = `
    nd."atvejoNr",
    nd."duomenuIvedimoData",
    nd."pirkimoVykdytojoPavadinimas",
    nd."tiekejoPavadinimas",
    nd."tiekejoJarKodas",
    nd."pirkimoNumeris",
    nd."sutartiesNutraukimoData"::date,
    nd."dataNuoKuriosSkaiciuojama"::date,
    nd."itrauktaIki"::date AS "itrauktasIki",
    nd."teismoData"::date,
    nd."teismoSprendimoData"::date,
    nd."teismoSprendimoLink",
    nd.metai,
    nd."paskutiniKartaMatytaSarase"`;

const MELAGINGAS_COLS = `
    nd."atvejoNr",
    nd."duomenuIvedimoData",
    nd."pirkimoVykdytojoPavadinimas",
    nd."tiekejoPavadinimas",
    nd."tiekejoJarKodas",
    nd."pirkimoNumeris",
    NULL::date AS "sutartiesNutraukimoData",
    nd."dataNuoKuriosSkaiciuojamasTerminas"::date AS "dataNuoKuriosSkaiciuojama",
    nd."itrauktasIki"::date,
    nd."teismoData"::date,
    NULL::date AS "teismoSprendimoData",
    nd."teismoSprendimoLink",
    nd.metai,
    nd."paskutiniKartaMatytaSarase"`;

/**
 * @param {string} tsQueryFunc
 * @param {number} limitParam - param index for limit
 * @param {number} offsetParam - param index for offset
 * @returns {string}
 */
function searchResultsQuery(tsQueryFunc, limitParam, offsetParam) {
    return `
        SELECT * FROM (
            SELECT ${NEPATIKIMAS_COLS}, NULL::text AS "irasymoPagrindas", 'Nepatikimas' AS "saltinis"
            FROM public."nepatikimiTiekejai" nd
            LEFT JOIN public."nepatikimiTiekejaiPagrindimai" p
                ON p."tiekejoJarKodas" = nd."tiekejoJarKodas" AND p."pirkimoNumeris" = nd."pirkimoNumeris"
            WHERE nd."search_index" @@ ${tsQueryFunc}('simple', $1)

            UNION ALL

            SELECT ${MELAGINGAS_COLS}, nd."irasymoPagrindas", 'Melagingas' AS "saltinis"
            FROM public."melagingiTiekejai" nd
            LEFT JOIN public."melagingiTiekejaiPagrindimai" p
                ON p."tiekejoJarKodas" = nd."tiekejoJarKodas" AND p."pirkimoNumeris" = nd."pirkimoNumeris"
            WHERE nd."search_index" @@ ${tsQueryFunc}('simple', $1)
        ) t
        ORDER BY "duomenuIvedimoData" DESC NULLS LAST
        LIMIT $${limitParam} OFFSET $${offsetParam}`;
}

/**
 * @returns {string}
 */
function defaultResultsQuery() {
    return `
        SELECT * FROM (
            SELECT ${NEPATIKIMAS_COLS}, NULL::text AS "irasymoPagrindas", 'Nepatikimas' AS "saltinis"
            FROM public."nepatikimiTiekejai" nd
            LEFT JOIN public."nepatikimiTiekejaiPagrindimai" p
                ON p."tiekejoJarKodas" = nd."tiekejoJarKodas" AND p."pirkimoNumeris" = nd."pirkimoNumeris"

            UNION ALL

            SELECT ${MELAGINGAS_COLS}, nd."irasymoPagrindas", 'Melagingas' AS "saltinis"
            FROM public."melagingiTiekejai" nd
            LEFT JOIN public."melagingiTiekejaiPagrindimai" p
                ON p."tiekejoJarKodas" = nd."tiekejoJarKodas" AND p."pirkimoNumeris" = nd."pirkimoNumeris"
        ) t
        ORDER BY "duomenuIvedimoData" DESC NULLS LAST
        LIMIT $1 OFFSET $2`;
}
/**
 * @param {{ cleanSearch: string, tsQueryFunc: string, limit: number, skip: number }} params
 * @returns {Promise<{ rows: object[], total: number }>}
 */
async function queryNepatikimi({ cleanSearch, tsQueryFunc, limit, skip }) {
    if (cleanSearch) {
        const [resultsRes, totalRes] = await Promise.all([
            postgres.query(searchResultsQuery(tsQueryFunc, 2, 3), [
                cleanSearch,
                limit,
                skip,
            ]),
            postgres.query(
    `SELECT COUNT(*) FROM (
        SELECT 1 FROM public."nepatikimiTiekejai" WHERE "search_index" @@ ${tsQueryFunc}('simple', $1)
        UNION ALL
        SELECT 1 FROM public."melagingiTiekejai" WHERE "search_index" @@ ${tsQueryFunc}('simple', $1)
    ) t`,
    [cleanSearch],
),
        ]);
        return {
            rows: resultsRes.rows,
            total: parseInt(totalRes.rows[0].count, 10),
        };
    }

    const [resultsRes, totalRes] = await Promise.all([
        postgres.query(defaultResultsQuery(), [limit, skip]),
        postgres.query(`
    SELECT (
        SELECT COUNT(*) FROM public."nepatikimiTiekejai" nd
        INNER JOIN public."nepatikimiTiekejaiPagrindimai" p
            ON p."tiekejoJarKodas" = nd."tiekejoJarKodas" AND p."pirkimoNumeris" = nd."pirkimoNumeris"
    ) + (
        SELECT COUNT(*) FROM public."melagingiTiekejai" nd
        INNER JOIN public."melagingiTiekejaiPagrindimai" p
            ON p."tiekejoJarKodas" = nd."tiekejoJarKodas" AND p."pirkimoNumeris" = nd."pirkimoNumeris"
    ) AS count`), ,
    ]);
    return {
        rows: resultsRes.rows,
        total: parseInt(totalRes.rows[0].count, 10),
    };
}

/**
 * @param {{ rows: object[], total: number, elapsed: number }} params
 * @returns {string}
 */
function buildNumberOfResults({ rows, total, elapsed }) {
    const trukme = (elapsed / 1000).toFixed(2) + "s";
    const source = `<span class="inline">(${trukme}, PostgreSQL)</span>`;
    if (rows.length < total)
        return `Rodomi ${rows.length} iš ${Number(total).linksniuotiK(["rezultato", "rezultatų"])} ${source}`;
    return `${Number(total).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} ${source}`;
}

nepatikimiIrMelagiaiRouter.get(
    "/nepatikimi",
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

        const { rows, total } = await queryNepatikimi({
            cleanSearch,
            tsQueryFunc,
            limit,
            skip,
        });

        if (req.query.json)
            return res.json({
                data: rows,
                currentPage: page,
                pageCount: Math.ceil(total / limit),
                total,
                limit
            });

        res.render("nepatikimiIrMelagiai/index", {
            customHead: config.customHead,
            values: { search: searchTerm },
            data: rows,
            queryParams: `&search=${encodeURIComponent(searchTerm)}`,
            query: req.query,
            search: cleanSearch,
            numberOfResults: buildNumberOfResults({
                rows,
                total,
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

nepatikimiIrMelagiaiRouter.get("/nepatikimi.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "",
        "Nepatikimi ir melagiai",
        "",
        "viespirkiai.org/nepatikimi",
    );
});

export default nepatikimiIrMelagiaiRouter;
