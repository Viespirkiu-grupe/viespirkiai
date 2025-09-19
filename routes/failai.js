import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { postgres } from "../postgres/postgres.js";

const failaiSearchRouter = express.Router();

failaiSearchRouter.get("/failai", cleanEmptyQueryParams, async (req, res) => {
    const startas = performance.now();

    const page = parseInt(req.query.page) || 1;
    let limit = 50;
    const MAX_LIMIT = 250;

    if (req.query.limit === "max") {
        limit = MAX_LIMIT;
    } else if (parseInt(req.query.limit) > MAX_LIMIT) {
        return res
            .status(400)
            .send(`Limitas per didelis. Maksimalus limitas yra ${MAX_LIMIT}.`);
    } else if (parseInt(req.query.limit) > 0) {
        limit = parseInt(req.query.limit) || limit;
    }

    const skip = (page - 1) * limit;

    if (req.query.search) {
        const searchTerm = req.query.search;

        try {
            const quoteMatch = searchTerm.match(/^"(.*)"$/);
            const tsQueryFunc = quoteMatch
                ? "phraseto_tsquery"
                : "plainto_tsquery";
            const cleanSearch = quoteMatch ? quoteMatch[1] : searchTerm;

            const queryText = `
              SELECT
                  f.*,
                  CASE
                      WHEN fp.salinti = true THEN '451 – Pašalinta'
                      ELSE f.pavadinimas
                  END AS pavadinimas,
                  CASE
                      WHEN fp.salinti = true THEN '451 – Pašalinta'
                      ELSE f.tekstas
                  END AS tekstas,
                  CASE
                      WHEN fp.salinti = true THEN '{}'::jsonb
                      ELSE f.metaduomenys
                  END AS metaduomenys
              FROM failai f
              LEFT JOIN "failuPasalinimai" fp
                     ON fp."dokId" = f."dokId"
                    AND fp."fileId" = f."fileId"
                    AND fp.salinti = true
              WHERE f.nuskaitytas >= 0
                AND f.search_index @@ ${tsQueryFunc}('simple', $1)
              LIMIT $2 OFFSET $3;
          `;

            const totalQuery = `
            SELECT COUNT(*)
            FROM failai
            WHERE nuskaitytas >= 0
              AND search_index @@ ${tsQueryFunc}('simple', $1);
          `;

            const [resultsRes, totalRes] = await Promise.all([
                postgres.query(queryText, [cleanSearch, limit, skip]),
                postgres.query(totalQuery, [cleanSearch]),
            ]);

            // Process results
            const results = resultsRes.rows.map((row) => {
                try {
                    row.tekstas = JSON.parse(row.tekstas).join(" ");
                } catch (e) {}

                delete row.saugojama;
                row.excerpt = makeExcerpt(row.tekstas, searchTerm);
                return row;
            });

            const total = parseInt(totalRes.rows[0].count, 10);

            // Paieškos užklausos informacija
            const trukme =
                ((performance.now() - startas) / 1000).toFixed(2) + "s";
            const rodomiRezultatai = results.length;
            const numberOfResults =
                rodomiRezultatai < total
                    ? `Rodomi ${rodomiRezultatai} iš ${Number(total).linksniuotiK(["rezultato", "rezultatų"])} <pre style="display: inline;">(${trukme}, Postgres)</pre>`
                    : `${Number(total).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} <pre style="display: inline;">(${trukme}, Postgres)</pre>`;

            if (req.query.json) {
                res.json({
                    data: results,
                    currentPage: page,
                    pageCount: Math.ceil(total / limit),
                });
                return;
            }

            res.render("failai/index", {
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
            });
        } catch (err) {
            console.error(err);
            res.status(500);
        }
    } else {
        let statistikaRes = await postgres.query(
            `SELECT * FROM statistika ORDER BY timestamp DESC LIMIT 1;`,
        );

        let statistika = statistikaRes.rows[0].data;

        res.render("failai/index", {
            customHead: config.customHead,
            values: {},
            statistika,
        });
    }
});

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

failaiSearchRouter.get("/failai.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "",
        "Failų paieška",
        "",
        "viespirkiai.top/failai",
    );
});

export default failaiSearchRouter;
