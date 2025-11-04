import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { postgres } from "../postgres/postgres.js";

const nepatikimiIrMelagiaiRouter = express.Router();

nepatikimiIrMelagiaiRouter.get(
    "/nepatikimi",
    cleanEmptyQueryParams,
    async (req, res) => {
        const startas = performance.now();

        const page = parseInt(req.query.page) || 1;
        let limit = 50;
        const MAX_LIMIT = 250;

        if (req.query.limit === "max") {
            limit = MAX_LIMIT;
        } else if (parseInt(req.query.limit) > MAX_LIMIT) {
            return res
                .status(400)
                .send(
                    `Limitas per didelis. Maksimalus limitas yra ${MAX_LIMIT}.`,
                );
        } else if (parseInt(req.query.limit) > 0) {
            limit = parseInt(req.query.limit) || limit;
        }

        const skip = (page - 1) * limit;

        let queryText, totalQuery, query2Text, total2Query;
        let cleanSearch = "";
        let searchTerm = req.query.search || "";
        if (req.query.search) {
            const quoteMatch = searchTerm.match(/^"(.*)"$/);
            const tsQueryFunc = quoteMatch
                ? "phraseto_tsquery"
                : "plainto_tsquery";
            cleanSearch = quoteMatch ? quoteMatch[1] : searchTerm;

            // Merged results query
            queryText = `SELECT *
            FROM (
                SELECT
                nd."atvejoNr",
                nd."duomenuIvedimoData" AS "duomenuIvedimoData_alias",
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
                nd."paskutiniKartaMatytaSarase",
                NULL::text AS "irasymoPagrindas",
                'Nepatikimas' AS "saltinis",
                p.*
                FROM public."nepatikimiTiekejai" nd
                INNER JOIN public."nepatikimiTiekejaiPagrindimai" p
                    ON p."tiekejoJarKodas" = nd."tiekejoJarKodas"
                   AND p."pirkimoNumeris" = nd."pirkimoNumeris"
                WHERE nd."search_index" @@ ${tsQueryFunc}('simple', $1)

                UNION ALL

                SELECT
                nd."atvejoNr",
                nd."duomenuIvedimoData" AS "duomenuIvedimoData_alias",
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
                nd."paskutiniKartaMatytaSarase",
                nd."irasymoPagrindas",
                'Melagingas' AS "saltinis",
                p.*
                FROM public."melagingiTiekejai" nd
                INNER JOIN public."melagingiTiekejaiPagrindimai" p
                    ON p."tiekejoJarKodas" = nd."tiekejoJarKodas"
                   AND p."pirkimoNumeris" = nd."pirkimoNumeris"
                WHERE nd."search_index" @@ ${tsQueryFunc}('simple', $1)
            ) t
            ORDER BY t."duomenuIvedimoData_alias" DESC NULLS LAST
            LIMIT $2 OFFSET $3;
            `;

            // Merged total count query
            totalQuery = `
              SELECT COUNT(*)
              FROM (
                  SELECT 1
                  FROM public."nepatikimiTiekejai"
                  WHERE "search_index" @@ ${tsQueryFunc}('simple', $1)

                  UNION ALL

                  SELECT 1
                  FROM public."melagingiTiekejai"
                  WHERE "search_index" @@ ${tsQueryFunc}('simple', $1)
              ) AS t;
            `;

            var [resultsRes, totalRes] = await Promise.all([
                postgres.query(queryText, [cleanSearch, limit, skip]),
                postgres.query(totalQuery, [cleanSearch]),
            ]);
        } else {
            // No search term: get newest entries
            // Merged results query (no search term)
            queryText = `SELECT *
            FROM (
                SELECT
                    nd."atvejoNr",
                    nd."duomenuIvedimoData" AS "duomenuIvedimoData_alias",
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
                    nd."paskutiniKartaMatytaSarase",
                    NULL::text AS "irasymoPagrindas",
                    'Nepatikimas' AS "saltinis",
                    p.*
                FROM public."nepatikimiTiekejai" nd
                INNER JOIN public."nepatikimiTiekejaiPagrindimai" p
                    ON p."tiekejoJarKodas" = nd."tiekejoJarKodas"
                   AND p."pirkimoNumeris" = nd."pirkimoNumeris"

                UNION ALL

                SELECT
                    nd."atvejoNr",
                    nd."duomenuIvedimoData" AS "duomenuIvedimoData_alias",
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
                    nd."paskutiniKartaMatytaSarase",
                    nd."irasymoPagrindas",
                    'Melagingas' AS "saltinis",
                    p.*
                FROM public."melagingiTiekejai" nd
                INNER JOIN public."melagingiTiekejaiPagrindimai" p
                    ON p."tiekejoJarKodas" = nd."tiekejoJarKodas"
                   AND p."pirkimoNumeris" = nd."pirkimoNumeris"
            ) t
            ORDER BY t."duomenuIvedimoData_alias" DESC NULLS LAST
            LIMIT $1 OFFSET $2;
         `;

            // Merged total count query
            totalQuery = `
              SELECT
                  (SELECT COUNT(*) FROM public."nepatikimiTiekejai") +
                  (SELECT COUNT(*) FROM public."melagingiTiekejai") AS count;
            `;

            var [resultsRes, totalRes] = await Promise.all([
                postgres.query(queryText, [limit, skip]),
                postgres.query(totalQuery),
            ]);
        }

        try {
            // Process results
            const results = resultsRes.rows;

            const total = parseInt(totalRes.rows[0].count, 10);

            // Paieškos užklausos informacija
            const trukme =
                ((performance.now() - startas) / 1000).toFixed(2) + "s";
            const rodomiRezultatai = results.length;
            const numberOfResults =
                rodomiRezultatai < total
                    ? `Rodomi ${rodomiRezultatai} iš ${Number(total).linksniuotiK(["rezultato", "rezultatų"])} <pre style="display: inline;">(${trukme}, PostgreSQL)</pre>`
                    : `${Number(total).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} <pre style="display: inline;">(${trukme}, PostgreSQL)</pre>`;

            if (req.query.json) {
                res.json({
                    data: results,
                    currentPage: page,
                    pageCount: Math.ceil(total / limit),
                });
                return;
            }

            res.render("nepatikimiIrMelagiai/index", {
                customHead: config.customHead,
                values: { search: searchTerm },
                data: results,
                queryParams: `&search=${encodeURIComponent(searchTerm)}`,
                query: req.query,
                search: cleanSearch,
                numberOfResults,
                currentPage: page,
                pageCount: Math.ceil(total / limit),
                galimaEksportuoti: false,
                req,
                usedHiddenFields: false,
            });
        } catch (err) {
            console.error(err);
            res.status(500);
        }
    },
);

function makeExcerpt(text, searchTerm, maxChars = 250, leading = 25) {
    let regex;

    if (/^".+"$/.test(searchTerm.trim())) {
        // Quoted: exact phrase
        const phrase = searchTerm.trim().slice(1, -1); // remove quotes
        regex = new RegExp(
            `(${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
            "gi",
        );
    } else {
        // Unquoted: match any word
        const words = searchTerm
            .split(/\s+/)
            .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        regex = new RegExp(`(${words.join("|")})`, "gi");
    }

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

nepatikimiIrMelagiaiRouter.get("/failai.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "",
        "Failų paieška",
        "",
        "viespirkiai.top/failai",
    );
});

export default nepatikimiIrMelagiaiRouter;
