import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { postgres } from "../postgres/postgres.js";
import { gautiStatistika } from "./statistika.js";
import Timings from "../utils/timings.js";
import { buildPostgresFailaiSearchFilter } from "../utils/filter.js";

const failaiSearchRouter = express.Router();

failaiSearchRouter.get(
    "/failai",
    cleanEmptyQueryParams,
    async (req, res, next) => {
        const startas = performance.now();
        let timings = new Timings();
        timings.start("limits");

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

        timings.end("limits");

        // Check if req.query has keys
        if (Object.keys(req.query).length > 0) {
            const searchTerm = req.query.search;

            // Remove quotes from search and trim whitespace
            let cleanSearch = (searchTerm || "").trim();
            cleanSearch.replace(/\s+/g, " ");

            var {
                sql,
                sqlCount,
                params,
                values,
                queryParams,
                usedHiddenFields,
                visiIrasai,
            } = buildPostgresFailaiSearchFilter(req.query, limit, page);

            try {
                ////
                // borrow a dedicated client for the count query
                var countClient = await postgres.connect();

                // start both queries immediately
                const resultsPromise = postgres.query(sql, params);
                const countPromise = countClient.query(
                    sqlCount,
                    params.slice(0, -2),
                );

                // wait for results first
                var resultsRes = await resultsPromise;

                // now wait for count query, giving it 0.5  s
                try {
                    let totalRes;
                    if (req.query.rezultatuSkaiciausPatikslinimas) {
                        totalRes = await countPromise;
                    } else {
                        totalRes = await Promise.race([
                            countPromise,
                            new Promise((_, reject) =>
                                setTimeout(
                                    () => reject(new Error("timeout")),
                                    500,
                                ),
                            ),
                        ]);
                    }

                    var total = parseInt(totalRes.rows[0].count, 10);

                    // Paieškos užklausos informacija
                    let trukme = (
                        (performance.now() - startas) / 1000 +
                        Number(req.query.trukme || 0)
                    ).toFixed(2);
                    let rodomiRezultatai = resultsRes.rows.length;
                    var numberOfResults =
                        rodomiRezultatai < total
                            ? `Rodomi ${rodomiRezultatai} iš ${Number(total).linksniuotiK(["rezultato", "rezultatų"])} <pre style="display: inline;" data-duration="${trukme}">(${trukme}s, PostgresSQL)</pre>`
                            : `${Number(total).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} <pre style="display: inline;" data-duration="${trukme}">(${trukme}s, PostgresSQL)</pre>`;

                    if (req.query.rezultatuSkaiciausPatikslinimas) {
                        res.render(
                            "pagination",
                            {
                                currentPage: page,
                                pageCount: Math.ceil(total / limit),
                                numberOfResults,
                                total,
                                queryParams,
                            },
                            (err, html) => {
                                if (err) {
                                    return next(err);
                                }

                                res.json({
                                    zinomasRezultatuSkaicius: true,
                                    total,
                                    numberOfResults,

                                    pagination: html,
                                });
                            },
                        );
                        return;
                    }
                } catch (err) {
                    // cancel count query if still running
                    try {
                        await pg.CancelQuery(countClient, countPromise);
                    } catch (_) {}
                }

                let rodomiRezultatai = resultsRes.rows.length;

                let trukme = ((performance.now() - startas) / 1000).toFixed(2);

                // total unknown
                var numberOfResults = `Rodomi ${rodomiRezultatai} iš <span class="rezultatai-nezinomas-total"> ? </span> rezultatų <pre data-duration="${trukme}" style="display: inline;"> (${trukme}s, PostgreSQL)</pre>`;
                total = 10_000; // for pagination
            } finally {
                countClient.release();
            }

            //////

            // const [resultsRes, totalRes] = await Promise.all([
            //     postgres.query(queryText, [cleanSearch, limit, skip]),
            //     postgres.query(totalQuery, [cleanSearch]),
            // ]);

            // Process results
            const results = resultsRes.rows.map((row) => {
                try {
                    row.tekstas = JSON.parse(row.tekstas).join(" ");
                } catch (e) {}

                delete row.saugojama;

                if (row?.metaduomenys?.signatures) {
                    row.metaduomenys.signatures.forEach((sig) => {
                        if (sig.signerFullDistinguishedName) {
                            sig.signerFullDistinguishedName =
                                sig.signerFullDistinguishedName.replace(
                                    /\d{4,}/g,
                                    "",
                                );
                        }
                    });
                }

                row.excerpt = makeExcerpt(row.tekstas, searchTerm);
                return row;
            });

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
                values,
                data: results,
                queryParams,
                query: req.query,
                search: cleanSearch,
                numberOfResults,
                currentPage: page,
                pageCount: Math.ceil(total / limit),
                galimaEksportuoti: false,
                req,
                usedHiddenFields,
            });
        } else {
            timings.start("statistika");
            let statistika = await gautiStatistika();
            timings.end("statistika");

            res.setHeader("Server-Timing", timings.serverTiming());

            res.renderCompiled("failai/index", {
                customHead: config.customHead,
                values: {},
                statistika,
                req,
                usedHiddenFields: false,
            });
        }
    },
);

function makeExcerpt(text = "", searchTerm = "", maxChars = 250, leading = 25) {
    let regex;

    if (text == null) {
        return "";
    }

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
        "viespirkiai.org/failai",
    );
});

failaiSearchRouter.get(
    ["/failai/list/md5/:md5", "/failai/list/md5/"],
    async (req, res) => {
        // Validate md5
        let md5 = req.params.md5;
        if (!md5) {
            md5 = "00000000000000000000000000000000";
        }

        if (!/^[a-fA-F0-9]{32}$/.test(md5)) {
            return res.status(400).send("Neteisingas MD5 formatas.");
        }

        // Find up to limit (default 100) md5 hashes after the given one
        const limit = parseInt(req.query.limit) || 100;
        // Max limit 10,000
        if (limit > 10_000) {
            return res
                .status(400)
                .send("Limitas per didelis. Maksimalus limitas yra 10000.");
        }

        const query = `
    SELECT id, md5, dydis, pavadinimas, extension
    FROM failai
    WHERE md5 > $1 AND parsiustas = 1
    ORDER BY md5 ASC
    LIMIT $2
  `;

        try {
            const result = await postgres.query(query, [md5, limit]);
            const failaiList = result.rows;
            res.json({ failai: failaiList });
        } catch (err) {
            console.error(err);
            res.status(500).send("Klaida vykdant užklausą.");
        }
    },
);

export default failaiSearchRouter;
