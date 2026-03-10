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
            cleanSearch = cleanSearch.replace(/\s+/g, " ");

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
                                    250,
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
                } catch (err) {}

                let rodomiRezultatai = resultsRes.rows.length;

                let trukme = ((performance.now() - startas) / 1000).toFixed(2);

                // total unknown
                var numberOfResults = `Rodomi ${rodomiRezultatai} iš <span class="rezultatai-nezinomas-total"> ? </span> rezultatų <pre data-duration="${trukme}" style="display: inline;"> (${trukme}s, PostgreSQL)</pre>`;
                total = 10_000; // for pagination
            } finally {
                if (countClient) {
                    countClient.release();
                }
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

failaiSearchRouter.get("/failai/neparsiunciami", async (req, res, next) => {
    try {
        // Pagination params
        const page = Math.max(1, parseInt(req.query.page) || 1);
        let limit = Math.max(1, parseInt(req.query.limit) || 250);
        if (req.query.limit === "max") {
            limit = 1_000_000;
        }
        const offset = (page - 1) * limit;

        // Optional source filter (saltinis), taken from search.ejs <select name="saltinis">
        const saltinis =
            typeof req.query.saltinis !== "undefined" &&
            req.query.saltinis !== ""
                ? req.query.saltinis
                : null;

        // Build WHERE clause dynamically to allow optional saltinis filter
        const whereClauses = ["parsiustas = -1"];
        const paramsBase = [];
        if (saltinis) {
            if (saltinis === "sutartys") {
                // When filtering for 'sutartys', include rows where saltinis IS NULL as well
                whereClauses.push(
                    `("saltinis" = $${paramsBase.length + 1} OR "saltinis" IS NULL)`,
                );
                paramsBase.push(saltinis);
            } else {
                whereClauses.push(`"saltinis" = $${paramsBase.length + 1}`);
                paramsBase.push(saltinis);
            }
        }
        const whereSQL = whereClauses.join(" AND ");

        // Count total rows for pagination
        const countQuery = `SELECT COUNT(*) AS total FROM failai WHERE ${whereSQL}`;
        const countRes = await postgres.query(countQuery, paramsBase);
        const total = parseInt(countRes.rows[0].total, 10) || 0;
        const pageCount = Math.max(1, Math.ceil(total / limit));

        // If CSV export requested -> return CSV (full export with reasonable cap)
        if (typeof req.query.csv !== "undefined") {
            // Allow optional csvLimit, otherwise cap at 10000
            const csvLimit = Math.min(
                100000,
                Math.max(1, parseInt(req.query.csvLimit) || 10000),
            );
            const csvParams = paramsBase.slice();
            csvParams.push(csvLimit);

            const selectCSV = `
                SELECT id, pavadinimas, extension, "saltinioId", "saltinis", "parsiuntimoBandymai", "paskutinisParsiuntimoBandymas", "dokId", "fileId"
                FROM failai
                WHERE ${whereSQL}
                ORDER BY COALESCE("paskutinisParsiuntimoBandymas", to_timestamp(0)) DESC
                LIMIT $${csvParams.length}
            `;

            const rowsRes = await postgres.query(selectCSV, csvParams);
            const rows = rowsRes.rows || [];

            const escape = (v) => {
                if (v === null || typeof v === "undefined") return "";
                let s = String(v);
                if (
                    s.includes('"') ||
                    s.includes(",") ||
                    s.includes("\n") ||
                    s.includes("\r")
                ) {
                    s = s.replace(/"/g, '""');
                    return `"${s}"`;
                }
                return s;
            };

            const header = [
                "id",
                "pavadinimas",
                "plėtinys",
                "saltinis",
                "saltinioNuoroda",
                "parsiuntimoBandymai",
                "paskutinisParsiuntimoBandymas",
            ];
            const lines = [header.join(",")];

            for (const r of rows) {
                const saltinisVal = r.saltinis || "sutartys";
                let saltinioLink = "";
                try {
                    if (saltinisVal === "sutartys") {
                        if (r.dokId && r.fileId) {
                            saltinioLink = `https://eviesiejipirkimai.lt/download.php?dok_id=${r.dokId}&file_id=${r.fileId}`;
                        } else if (r.saltinioId) {
                            saltinioLink = `https://eviesiejipirkimai.lt/${r.saltinioId}`;
                        }
                    } else if (saltinisVal === "neskelbiamosDerybos") {
                        if (r.saltinioId)
                            saltinioLink = `https://eviesiejipirkimai.lt/${r.saltinioId}`;
                    } else if (saltinisVal === "cvpIs") {
                        const parts = (r.saltinioId || "").split("/");
                        if (parts.length >= 3) {
                            saltinioLink = `https://viesiejipirkimai.lt/epps/cft/downloadDocumentVersion.do?versionId=${parts[2]}&documentId=${parts[1]}`;
                        }
                    } else if (saltinisVal === "mvpAprasai") {
                        if (r.saltinioId)
                            saltinioLink = `https://mw.eviesiejipirkimai.lt/${r.saltinioId}`;
                    }
                } catch (e) {
                    saltinioLink = "";
                }

                lines.push(
                    [
                        escape(r.id),
                        escape(r.pavadinimas),
                        escape(r.extension),
                        escape(saltinisVal),
                        escape(saltinioLink),
                        escape(r.parsiuntimoBandymai),
                        escape(r.paskutinisParsiuntimoBandymas),
                    ].join(","),
                );
            }

            // Prepend UTF-8 BOM so Excel/other clients recognize UTF-8 and Lithuanian letters correctly
            const csvContent = "\uFEFF" + lines.join("\r\n");
            res.setHeader("Content-Type", "text/csv; charset=utf-8");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename="neparsiunciami_${new Date().toISOString().slice(0, 10)}.csv"`,
            );
            return res.send(csvContent);
        }

        // Normal paginated select
        const params = paramsBase.slice();
        params.push(limit);
        params.push(offset);

        const selectQuery = `
            SELECT id, pavadinimas, extension, "saltinioId", "saltinis", "parsiuntimoBandymai", "paskutinisParsiuntimoBandymas", "dokId", "fileId"
            FROM failai
            WHERE ${whereSQL}
            ORDER BY COALESCE("paskutinisParsiuntimoBandymas", to_timestamp(0)) DESC
            LIMIT $${params.length - 1} OFFSET $${params.length}
        `;

        const result = await postgres.query(selectQuery, params);
        const files = (result.rows || []).map((r) => {
            // default source to 'sutartys' if missing
            const saltinisVal = r.saltinis || "sutartys";

            // Build a public link for the source id similar to modules/failai/parsiusti.js logic
            let saltinioLink = "";
            try {
                if (saltinisVal === "sutartys") {
                    // prefer dokId/fileId if present
                    if (r.dokId && r.fileId) {
                        saltinioLink = `https://eviesiejipirkimai.lt/download.php?dok_id=${r.dokId}&file_id=${r.fileId}`;
                    } else if (r.saltinioId) {
                        // fallback to using saltinioId path
                        saltinioLink = `https://eviesiejipirkimai.lt/${r.saltinioId}`;
                    }
                } else if (saltinisVal === "neskelbiamosDerybos") {
                    if (r.saltinioId)
                        saltinioLink = `https://eviesiejipirkimai.lt/${r.saltinioId}`;
                } else if (saltinisVal === "cvpIs") {
                    const parts = (r.saltinioId || "").split("/");
                    // expected format like /some/{documentId}/{versionId}
                    if (parts.length >= 3) {
                        const documentId = parts[1];
                        const versionId = parts[2];
                        saltinioLink = `https://viesiejipirkimai.lt/epps/cft/downloadDocumentVersion.do?versionId=${versionId}&documentId=${documentId}`;
                    }
                } else if (saltinisVal === "mvpAprasai") {
                    if (r.saltinioId)
                        saltinioLink = `https://mw.eviesiejipirkimai.lt/${r.saltinioId}`;
                } else if (saltinisVal === "archive") {
                    // archive - no public link (could be implemented if desired)
                    saltinioLink = "";
                }
            } catch (e) {
                saltinioLink = "";
            }

            // Provide plėtinys alias and normalized saltinis + link for the view
            return {
                ...r,
                pletinys: r.extension,
                saltinis: saltinisVal,
                saltinioLink,
            };
        });

        // Prepare queryParams for pagination links (preserve saltinis and limit)
        const preservedParams = [];
        if (saltinis)
            preservedParams.push(`saltinis=${encodeURIComponent(saltinis)}`);
        if (req.query.limit)
            preservedParams.push(
                `limit=${encodeURIComponent(req.query.limit)}`,
            );
        const queryParams = preservedParams.join("&");

        res.render("failai/neparsiunciami", {
            files,
            customHead: config.customHead,
            req,
            currentPage: page,
            pageCount,
            total,
            queryParams,
            saltinis: saltinis || "",
        });
    } catch (err) {
        return next(err);
    }
});

failaiSearchRouter.get("/failai/statistika/sse", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    res.write("retry: 1000\n\n"); // client reconnect delay (ms)

    let running = true;
    req.on("close", () => (running = false));

    const sendUpdate = async () => {
        const statistika = await gautiStatistika();

        req.app.render("failai/statistika", { statistika }, (err, html) => {
            if (err) {
                console.error("Rendering error:", err);
                return;
            }
            res.write(`data: ${JSON.stringify(html)}\n\n`);
        });
    };

    const interval = setInterval(async () => {
        if (!running) return clearInterval(interval);
        await sendUpdate();
    }, 250);
});

function makeExcerpt(text = "", searchTerm = "", maxChars = 250, leading = 25) {
    let regex;

    if (text == null) {
        return "";
    }

    // remove HTML tags
    text = text.replace(/<[^>]+>/g, "");

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

failaiSearchRouter.get("/failai/map", async (req, res) => {
    // Query lat/lon from PostGIS
    const response = await postgres.query(`
      SELECT ST_Y(location::geometry) AS lat,
             ST_X(location::geometry) AS lon
      FROM public.failai
      WHERE location IS NOT NULL;
    `);

    // Convert to Leaflet-friendly [lat, lon] arrays
    const locations = response.rows.map((row) => [row.lat, row.lon]);

    res.render("failai/map", {
        locations,
        customHead: config.customHead,
        req,
    });
});

failaiSearchRouter.get("/failai/topExtension", async (req, res) => {
    let page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    let start = performance.now();
    let extensionRes = await postgres.query(
        `
        SELECT *
        FROM "failaiStatsExtension"
        WHERE count > 0
        ORDER BY count DESC
        LIMIT $1 OFFSET $2
    `,
        [limit, offset],
    );

    let extensionCountRes = await postgres.query(`
        SELECT COUNT(*) AS total
        FROM "failaiStatsExtension" WHERE count > 0
    `);
    let end = performance.now();

    const trukme = ((end - start) / 1000).toFixed(2) + "s";
    const rodomiRezultatai = extensionRes.rowCount;
    const numberOfResults =
        rodomiRezultatai < parseInt(extensionCountRes.rows[0].total)
            ? `Rodomi ${rodomiRezultatai} iš ${Number(extensionCountRes.rows[0].total).linksniuotiK(["rezultato", "rezultatų"])} <pre style="display: inline;">(${trukme}, PostgreSQL)</pre>`
            : `${Number(extensionCountRes.rows[0].total).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} <pre style="display: inline;">(${trukme}, PostgreSQL)</pre>`;

    let extension = extensionRes.rows;
    let totalExtensionCount = parseInt(extensionCountRes.rows[0].total);

    res.render("failai/topExtension", {
        extension,
        totalExtensionCount,
        numberOfResults,
        customHead: config.customHead,
        currentPage: page,
        pageCount: Math.ceil(totalExtensionCount / limit),
        req,
        queryParams: "",
    });
});

failaiSearchRouter.get("/failai/ocr", async (req, res) => {
    let ocrStatsRes = await postgres.query(
        `SELECT * FROM "failaiOcrStats" ORDER BY count DESC`,
    );
    let ocrStats = ocrStatsRes.rows;
    ocrStats = ocrStats.map((stat) => ({
        ...stat,
        tipas: stat.tipas.charAt(0).toUpperCase() + stat.tipas.slice(1),
    }));
    const idMap = {
        Baigta: 1,
        Nepalaikoma: "-",
        Galima: "-",
        Rezervuota: -3,
        Rekomenduojama: 0,
        Nepavyko: -1,
    };
    ocrStats = ocrStats.map((stat) => ({
        ...stat,
        id: idMap[stat.tipas],
    }));

    let ocrStatsDayRes = await postgres.query(
        `SELECT * FROM "failaiOcrRezultataiStatsDay" ORDER BY date DESC`,
    );
    let ocrStatsDay = ocrStatsDayRes.rows;

    let ocrNuskaitytojaiRes = await postgres.query(
        `SELECT
            n."nuskaitytiDokumentai",
            n."viesasPavadinimas",
            n."pavadinimas",
            n."rezervacijos",
            COALESCE(SUM(s.results), 0) AS "results",
            COALESCE(SUM(s.pages),   0) AS "pages",
            COALESCE(SUM(s.words),   0) AS "words"
        FROM "ocrNuskaitytojai" n
        LEFT JOIN "failaiOcrRezultataiStatsDayNode" s ON s.node = n.pavadinimas
        GROUP BY n."nuskaitytiDokumentai", n."viesasPavadinimas", n."pavadinimas", n."rezervacijos"
        ORDER BY n."nuskaitytiDokumentai" DESC
        LIMIT 100`,
    );
    let ocrNuskaitytojai = ocrNuskaitytojaiRes.rows;

    res.render("failai/ocr", {
        ocrStats,
        ocrStatsDay,
        ocrNuskaitytojai,
        customHead: config.customHead,
        req,
    });
});

export default failaiSearchRouter;
