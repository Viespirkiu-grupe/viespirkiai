import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { postgres } from "../postgres/postgres.js";
import { gautiStatistika } from "./statistika.js";
import Timings from "../utils/timings.js";
import { searchFailai, countFailai } from "../modules/failai/searchFailai.js";
import { OCR_STATES } from "../modules/failai/ocr.js";

const failaiSearchRouter = express.Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
const COUNT_TIMEOUT_MS = 250;

function buildFailaiStatistikaPayload(statistika) {
    const totalWords = Number(statistika.nuskaitymas.zodziai.total);
    const failaiSuZodziais = Number(statistika.nuskaitymas.zodziai.failaiSuZodziais);
    const visiFailai = Number(statistika.failai.kiekiai.visi);
    const visiDydziai = Number(statistika.failai.dydziai.visi);
    const duomenuBaitai =
        visiDydziai *
        (visiFailai > 0 ? failaiSuZodziais / visiFailai : 0);

    return {
        atnaujinta: new Date(statistika.atnaujinta).toLtDateTime(),
        totalWordsNumber: totalWords.displayWithSpaces(),
        totalWordsLabel: `${totalWords.linksniuotiOnly(["žodis", "žodžiai", "žodžių", "žodžio"])} teksto`,
        dataSize: Number(Number(duomenuBaitai.toFixed(2))).convertUnit({
            from: "B",
            to: "GB",
        }),
        filesWithWordsNumber: failaiSuZodziais.displayWithSpaces(),
        filesWithWordsLabel: failaiSuZodziais.linksniuotiOnly([
            "failas",
            "failai",
            "failų",
            "failo",
        ]),
    };
}

function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a, b) {
    if (a === b) {
        return true;
    }

    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) {
            return false;
        }

        for (let i = 0; i < a.length; i += 1) {
            if (!deepEqual(a[i], b[i])) {
                return false;
            }
        }

        return true;
    }

    if (isObject(a) && isObject(b)) {
        const keysA = Object.keys(a);
        const keysB = Object.keys(b);

        if (keysA.length !== keysB.length) {
            return false;
        }

        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) {
                return false;
            }

            if (!deepEqual(a[key], b[key])) {
                return false;
            }
        }

        return true;
    }

    return false;
}

function diffPayload(prev, next) {
    if (prev === null) {
        return next;
    }

    if (deepEqual(prev, next)) {
        return undefined;
    }

    if (Array.isArray(next)) {
        return next;
    }

    if (isObject(next) && isObject(prev)) {
        const diff = {};

        for (const key of Object.keys(next)) {
            const childDiff = diffPayload(prev[key], next[key]);
            if (childDiff !== undefined) {
                diff[key] = childDiff;
            }
        }

        return Object.keys(diff).length > 0 ? diff : undefined;
    }

    return next;
}

/**
 * @param {{ limit?: string }} query
 * @returns {{ limit: number } | { error: string }}
 */
function parseLimit(query, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) {
    if (query.limit === "max") return { limit: maxLimit };
    const n = parseInt(query.limit);
    if (n > maxLimit)
        return {
            error: `Limitas per didelis. Maksimalus limitas yra ${maxLimit}.`,
        };
    if (n > 0) return { limit: n };
    return { limit: defaultLimit };
}

/**
 * @param {{ rows: object[], total: number, elapsed: number, engine?: string }} params
 * @returns {string}
 */
function buildNumberOfResults({ rows, total, elapsed, engine = "PostgreSQL", approximate = false }) {
    const trukme = (elapsed / 1000).toFixed(2);
    const source = `<pre class="inline" data-duration="${trukme}">(${trukme}s, ${engine})</pre>`;
    if (approximate) {
        const rounded = Math.round(total / 100) * 100 || total;
        return `Apie ${Number(rounded).linksniuotiK(["rezultato", "rezultatų"])} ${source}`;
    }
    if (rows.length < total)
        return `Rodomi ${rows.length} iš ${Number(total).linksniuotiK(["rezultato", "rezultatų"])} ${source}`;
    return `${Number(total).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} ${source}`;
}

// Maps each Lithuanian char (and its ASCII equivalent) to a character class
// that matches both forms, for use in case-insensitive regexes.
const LT_FOLD_CLASS = {
    a: '[aą]', ą: '[aą]',
    c: '[cč]', č: '[cč]',
    e: '[eęė]', ę: '[eęė]', ė: '[eęė]',
    i: '[iį]', į: '[iį]',
    s: '[sš]', š: '[sš]',
    u: '[uųū]', ų: '[uųū]', ū: '[uųū]',
    z: '[zž]', ž: '[zž]',
};

function foldAwareEscape(word) {
    let result = '';
    for (const ch of word) {
        if (/[.*+?^${}()|[\]\\]/.test(ch)) {
            result += '\\' + ch;
        } else {
            result += LT_FOLD_CLASS[ch.toLowerCase()] ?? ch;
        }
    }
    return result;
}

/**
 * @param {string} text
 * @param {string} searchTerm
 * @param {number} [maxChars=250]
 * @param {number} [leading=25]
 * @returns {string}
 */
function makeExcerpt(text = "", searchTerm = "", maxChars = 250, leading = 25) {
    if (!text) return "";
    text = text.replace(/<[^>]+>/g, "");

    const isPhrase = /^".+"$/.test(searchTerm.trim());
    const inner = isPhrase ? searchTerm.trim().slice(1, -1) : null;
    const regex = isPhrase
        ? new RegExp(`(${foldAwareEscape(inner)})`, "gi")
        : new RegExp(
              `(${searchTerm
                  .split(/\s+/)
                  .map(foldAwareEscape)
                  .join("|")})`,
              "gi",
          );

    const match = regex.exec(text);
    if (!match)
        return text.slice(0, maxChars) + (text.length > maxChars ? "..." : "");

    const start = Math.max(0, match.index - Math.floor(leading));
    const end = Math.min(text.length, start + maxChars);
    return (
        text.slice(start, end).replace(regex, "<mark>$1</mark>") +
        (end < text.length ? "..." : "")
    );
}

/**
 * @param {object} row
 * @returns {string}
 */
function buildSaltinioLink(row) {
    const saltinis = row.saltinis || "sutartys";
    try {
        if (saltinis === "sutartys") {
            if (row.dokId && row.fileId)
                return `https://eviesiejipirkimai.lt/download.php?dok_id=${row.dokId}&file_id=${row.fileId}`;
            if (row.saltinioId)
                return `https://eviesiejipirkimai.lt/${row.saltinioId}`;
        }
        if (saltinis === "neskelbiamosDerybos" && row.saltinioId)
            return `https://eviesiejipirkimai.lt/${row.saltinioId}`;
        if (saltinis === "cvpIs") {
            const parts = (row.saltinioId || "").split("/");
            if (parts.length >= 3)
                return `https://viesiejipirkimai.lt/epps/cft/downloadDocumentVersion.do?versionId=${parts[2]}&documentId=${parts[1]}`;
        }
        if (saltinis === 'cvpp'){
            const parts = String(row.saltinioId || "")
                .split("/")
                .filter(Boolean);
            if (parts.length >= 3 && parts[0]) {
                return `https://pirkimai.eviesiejipirkimai.lt/app/rfq/rwlentrance_s.asp?PID=${encodeURIComponent(parts[0])}&B=PPO`;
            }
            const dvid = parts.length >= 3 ? parts[1] : parts[0];
            const lid = parts.length >= 3 ? parts[2] : parts[1];
            if (!dvid || !lid) return "";
            return `https://pirkimai.eviesiejipirkimai.lt/app/docmgmt/downloadPublicDocument.asp?FMT=5&AT=3&LID=${lid}&DVID=${dvid}`;
        }
        if (saltinis === "mvpAprasai" && row.saltinioId)
            return `https://mw.eviesiejipirkimai.lt/${row.saltinioId}`;
    } catch {
        // fall through
    }
    return "";
}

/**
 * @param {object} row
 * @returns {object}
 */
function enrichFailasRow(row) {
    return {
        ...row,
        pletinys: row.extension,
        saltinis: row.saltinis || "sutartys",
        saltinioLink: buildSaltinioLink(row),
    };
}

/**
 * @param {object[]} rows
 * @param {string} searchTerm
 * @returns {object[]}
 */
function processSearchResults(rows, searchTerm) {
    return rows.map((row) => {
        try {
            row.tekstas = JSON.parse(row.tekstas).join(" ");
        } catch {}
        if (row.tekstas) {
            if (row.tekstas.startsWith('["')) row.tekstas = row.tekstas.slice(2);
            if (row.tekstas.endsWith('"]')) row.tekstas = row.tekstas.slice(0, -2);
        }
        row.metaduomenys?.signatures?.forEach((sig) => {
            if (sig.signerFullDistinguishedName)
                sig.signerFullDistinguishedName =
                    sig.signerFullDistinguishedName.replace(/\d{4,}/g, "");
        });
        row.excerpt = makeExcerpt(row.tekstas, searchTerm);
        return row;
    });
}


failaiSearchRouter.get(
    "/failai",
    cleanEmptyQueryParams,
    async (req, res, next) => {
        const startas = performance.now();
        const timings = new Timings();

        if (!Object.keys(req.query).length) {
            timings.start("statistika");
            const statistika = await gautiStatistika();
            timings.end("statistika");
            res.setHeader("Server-Timing", timings.serverTiming());
            return res.renderCompiled("failai/index", {
                customHead: config.customHead,
                values: {},
                statistika,
                req,
                usedHiddenFields: false,
            });
        }

        timings.start("limits");
        const parsedLimit = parseLimit(req.query);
        if ("error" in parsedLimit)
            return res.status(400).send(parsedLimit.error);
        const { limit } = parsedLimit;
        const page = parseInt(req.query.page) || 1;
        timings.end("limits");

        const searchTerm = req.query.search || "";
        const cleanSearch = searchTerm.trim().replace(/\s+/g, " ");

        const {
            results: rawResults,
            values,
            queryParams,
            usedHiddenFields,
            total: searchTotal,
            approximate = false,
            engine,
        } = await searchFailai(req.query, { limit, page });

        const results = processSearchResults(rawResults, searchTerm);

        let total, numberOfResults;
        // If searchFailai already returned a total (e.g. from Quickwit), use it
        // directly; otherwise race countFailai against the timeout.
        const countPromise =
            searchTotal !== null
                ? Promise.resolve(searchTotal)
                : countFailai(req.query);

        try {
            const totalRes = req.query.rezultatuSkaiciausPatikslinimas
                ? await countPromise
                : await Promise.race([
                      countPromise,
                      new Promise((_, reject) =>
                          setTimeout(
                              () => reject(new Error("timeout")),
                              COUNT_TIMEOUT_MS,
                          ),
                      ),
                  ]);

            total = totalRes;
            const elapsed =
                performance.now() - startas + Number(req.query.trukme || 0);
            numberOfResults = buildNumberOfResults({
                rows: results,
                total,
                elapsed,
                engine,
                approximate,
            });

            if (req.query.rezultatuSkaiciausPatikslinimas) {
                return res.render(
                    "pagination",
                    {
                        currentPage: page,
                        pageCount: Math.ceil(total / limit),
                        numberOfResults,
                        total,
                        queryParams,
                    },
                    (err, html) => {
                        if (err) return next(err);
                        res.json({
                            zinomasRezultatuSkaicius: true,
                            total,
                            numberOfResults,
                            pagination: html,
                        });
                    },
                );
            }
        } catch {
            total = 10_000;
            const trukme = ((performance.now() - startas) / 1000).toFixed(2);
            numberOfResults = `Rodomi ${results.length} iš <span class="rezultatai-nezinomas-total"> ? </span> rezultatų <pre data-duration="${trukme}" class="inline"> (${trukme}s, ${engine})</pre>`;
        }

        if (req.query.json)
            return res.json({
                data: results,
                currentPage: page,
                pageCount: Math.ceil(total / limit),
            });

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
    },
);


failaiSearchRouter.get("/failai/neparsiunciami", async (req, res, next) => {
    /**
     * @param {string[]} params
     * @returns {string}
     */
    function buildWhereClause(saltinis) {
        const clauses = [];
        const params = [];
        if (saltinis) {
            if (saltinis === "sutartys") {
                clauses.push(`(f.saltinis = $${params.length + 1} OR f.saltinis IS NULL)`);
            } else {
                clauses.push(`f.saltinis = $${params.length + 1}`);
            }
            params.push(saltinis);
        }
        return { whereSQL: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", params };
    }

    const parsedLimit = parseLimit(req.query, 250, 1_000_000);
    if ("error" in parsedLimit) return res.status(400).send(parsedLimit.error);
    const { limit } = parsedLimit;

    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * limit;
    const saltinis = req.query.saltinis || null;

    const { whereSQL, params: baseParams } = buildWhereClause(saltinis);

    const countRes = await postgres.query(
        `SELECT COUNT(*) AS total
        FROM public."failaiParsiuntimoQueue" q
        JOIN public.failai f ON f.id = q.id
        ${whereSQL}`,
        baseParams,
    );
    const total = parseInt(countRes.rows[0].total, 10) || 0;
    const pageCount = Math.max(1, Math.ceil(total / limit));

    if (typeof req.query.csv !== "undefined") {
        const csvLimit = Math.min(
            100_000,
            Math.max(1, parseInt(req.query.csvLimit) || 10_000),
        );
        const csvParams = [...baseParams, csvLimit];

        const rowsRes = await postgres.query(
            `SELECT f.id, f.pavadinimas, f.extension, f."saltinioId", f.saltinis,
                    q.bandymai AS "parsiuntimoBandymai",
                    q."paskutinisBandymas" AS "paskutinisParsiuntimoBandymas",
                    q.state, f."dokId", f."fileId"
            FROM public."failaiParsiuntimoQueue" q
            JOIN public.failai f ON f.id = q.id
            ${whereSQL}
            ORDER BY q."paskutinisBandymas" ASC NULLS FIRST
            LIMIT $${csvParams.length}`,
            csvParams,
        );

        const escape = (v) => {
            if (v == null) return "";
            const s = String(v);
            if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
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
        for (const r of rowsRes.rows) {
            lines.push(
                [
                    escape(r.id),
                    escape(r.pavadinimas),
                    escape(r.extension),
                    escape(r.saltinis || "sutartys"),
                    escape(buildSaltinioLink(r)),
                    escape(r.parsiuntimoBandymai),
                    escape(r.paskutinisParsiuntimoBandymas),
                ].join(","),
            );
        }

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="neparsiunciami_${new Date().toISOString().slice(0, 10)}.csv"`,
        );
        return res.send("\uFEFF" + lines.join("\r\n"));
    }

    const params = [...baseParams, limit, offset];
    const result = await postgres.query(
        `SELECT f.id, f.pavadinimas, f.extension, f."saltinioId", f.saltinis,
                q.bandymai AS "parsiuntimoBandymai",
                q."paskutinisBandymas" AS "paskutinisParsiuntimoBandymas",
                q.state, f."dokId", f."fileId"
        FROM public."failaiParsiuntimoQueue" q
        JOIN public.failai f ON f.id = q.id
        ${whereSQL}
        ORDER BY q."paskutinisBandymas" ASC NULLS FIRST
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
    );

    const queryParams = [
        saltinis && `saltinis=${encodeURIComponent(saltinis)}`,
        req.query.limit && `limit=${encodeURIComponent(req.query.limit)}`,
    ]
        .filter(Boolean)
        .join("&");

    res.render("failai/neparsiunciami", {
        customHead: config.customHead,
        files: result.rows.map(enrichFailasRow),
        req,
        currentPage: page,
        pageCount,
        total,
        queryParams,
        saltinis: saltinis || "",
    });
});

failaiSearchRouter.get("/failai/statistika/sse", async (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
        res.flushHeaders();
    }
    res.write("retry: 1000\n\n");

    let running = true;
    let lastPayload = null;
    let lastTimestampOnlySentAt = 0;
    const heartbeat = setInterval(() => {
        if (!running) {
            return;
        }
        res.write(": ping\n\n");
    }, 15000);

    req.on("close", () => {
        running = false;
        clearInterval(heartbeat);
    });

    const interval = setInterval(async () => {
        if (!running) {
            clearInterval(interval);
            return;
        }
        const statistika = await gautiStatistika();
        const nextPayload = buildFailaiStatistikaPayload(statistika);
        const payloadDelta = diffPayload(lastPayload, nextPayload);

        if (payloadDelta === undefined) {
            return;
        }

        const keys = Object.keys(payloadDelta);
        if (keys.length === 1 && keys[0] === "atnaujinta") {
            const now = Date.now();
            if (now - lastTimestampOnlySentAt < 1000) {
                return;
            }
            lastTimestampOnlySentAt = now;
        }

        lastPayload = nextPayload;
        res.write(`data: ${JSON.stringify(payloadDelta)}\n\n`);
    }, 250);
});

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
        let md5 = req.params.md5 || "00000000000000000000000000000000";
        if (!/^[a-fA-F0-9]{32}$/.test(md5))
            return res.status(400).send("Neteisingas MD5 formatas.");

        const parsedLimit = parseLimit(req.query, 100, 10_000);
        if ("error" in parsedLimit)
            return res
                .status(400)
                .send(`Limitas per didelis. Maksimalus limitas yra 10000.`);

        const result = await postgres.query(
            `SELECT id, md5, dydis, pavadinimas, extension FROM failai WHERE md5 > $1 AND parsiustas = 1 ORDER BY md5 ASC LIMIT $2`,
            [md5, parsedLimit.limit],
        );
        res.json({ failai: result.rows });
    },
);

failaiSearchRouter.get("/failai/map", async (req, res) => {
    const { rows } = await postgres.query(
        `SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon FROM public.failai WHERE location IS NOT NULL`,
    );
    res.render("failai/map", {
        locations: rows.map((r) => [r.lat, r.lon]),
        customHead: config.customHead,
        req,
    });
});

failaiSearchRouter.get("/failai/galerija", async (req, res) => {
    const { rows } = await postgres.query(`
      SELECT * FROM failai
      WHERE "ocrState" = 1
        AND ("zodziuSkaicius" IS NULL OR "zodziuSkaicius" <= 10)
        AND lower(extension) = ANY(ARRAY['jpg','jpeg','png','bmp','gif','webp','heic'])
      ORDER BY random()
      LIMIT 50    `);
    const seen = new Set();
    const images = rows.filter((r) => !seen.has(r.id) && seen.add(r.id));
    res.render("failai/galerija", {
        images,
        customHead: config.customHead,
        req,
    });
});

failaiSearchRouter.get("/failai/topExtension", async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * DEFAULT_LIMIT;
    const startas = performance.now();

    const [extensionRes, countRes] = await Promise.all([
        postgres.query(
            `SELECT * FROM "failaiStatsExtension" WHERE count > 0 ORDER BY count DESC, extension ASC LIMIT $1 OFFSET $2`,
            [DEFAULT_LIMIT, offset],
        ),
        postgres.query(
            `SELECT COUNT(*) AS total FROM "failaiStatsExtension" WHERE count > 0`,
        ),
    ]);

    const total = parseInt(countRes.rows[0].total, 10);
    const numberOfResults = buildNumberOfResults({
        rows: extensionRes.rows,
        total,
        elapsed: performance.now() - startas,
    });

    res.render("failai/topExtension", {
        customHead: config.customHead,
        extension: extensionRes.rows,
        totalExtensionCount: total,
        numberOfResults,
        currentPage: page,
        pageCount: Math.ceil(total / DEFAULT_LIMIT),
        req,
        queryParams: "",
    });
});

failaiSearchRouter.get("/failai/ocr", async (req, res) => {
    const [ocrStatsRes, ocrStatsDayRes, ocrNuskaitytojaiRes] =
        await Promise.all([
            postgres.query(
                `SELECT * FROM "failaiOcrStats" ORDER BY count DESC`,
            ),
            postgres.query(
                `SELECT * FROM "failaiOcrRezultataiStatsDay" ORDER BY date DESC`,
            ),
            postgres.query(
                `SELECT n.id, n."nuskaitytiDokumentai", n."viesasPavadinimas", n."pavadinimas", n."rezervacijos",
                    COALESCE(SUM(s.results), 0) AS "results", COALESCE(SUM(s.pages), 0) AS "pages", COALESCE(SUM(s.words), 0) AS "words"
                 FROM "ocrNuskaitytojai" n
                 LEFT JOIN "failaiOcrRezultataiStatsDayNode" s ON s.node = n.pavadinimas
                 GROUP BY n.id, n."nuskaitytiDokumentai", n."viesasPavadinimas", n."pavadinimas", n."rezervacijos"
                 ORDER BY n."nuskaitytiDokumentai" DESC LIMIT 100`,
            ),
        ]);

    const ocrStats = ocrStatsRes.rows.map((stat) => {
        const state = OCR_STATES.find(
            (s) => s.camel === stat.tipas || s.text === stat.tipas,
        );
        return { ...stat, ...state };
    });

    const ocrStatsDay = ocrStatsDayRes.rows;
    const latestDay = ocrStatsDay[0]; // jau ORDER BY date DESC
    const ocrPerMinute = latestDay
        ? (() => {
              const nowLT = new Date(
                  new Date().toLocaleString("en-US", {
                      timeZone: "Europe/Vilnius",
                  }),
              );
              const todayLT = nowLT.toISOString().slice(0, 10);
              const isToday = latestDay.date === todayLT;
              const minutes = isToday
                  ? nowLT.getHours() * 60 + nowLT.getMinutes() || 1
                  : 1440;
              return {
                  date: latestDay.date,
                  results: (latestDay.results / minutes).toFixed(2),
                  pages: (latestDay.pages / minutes).toFixed(2),
                  words: (latestDay.words / minutes).toFixed(2),
              };
          })()
        : null;

    res.render("failai/ocr", {
        customHead: config.customHead,
        ocrStats,
        ocrStatsDay,
        ocrPerMinute,
        ocrNuskaitytojai: ocrNuskaitytojaiRes.rows,
        req,
    });
});

failaiSearchRouter.get("/failai/ocr/:id", async (req, res, next) => {
    const nodeId = parseInt(req.params.id, 10);
    if (isNaN(nodeId)) return next();

    const [nuskaitytojasRes, ocrStatsDayRes] = await Promise.all([
        postgres.query(
            `SELECT n.id, n."nuskaitytiDokumentai", n."viesasPavadinimas", n."pavadinimas", n."rezervacijos",
              COALESCE(SUM(s.results), 0) AS "results", COALESCE(SUM(s.pages), 0) AS "pages", COALESCE(SUM(s.words), 0) AS "words"
           FROM "ocrNuskaitytojai" n
           LEFT JOIN "failaiOcrRezultataiStatsDayNode" s ON s.node = n.pavadinimas
           WHERE n.id = $1
           GROUP BY n.id, n."nuskaitytiDokumentai", n."viesasPavadinimas", n."pavadinimas", n."rezervacijos"`,
            [nodeId],
        ),
        postgres.query(
            `SELECT s.* FROM "failaiOcrRezultataiStatsDayNode" s
             JOIN "ocrNuskaitytojai" n ON n.pavadinimas = s.node
             WHERE n.id = $1
             ORDER BY s.date DESC`,
            [nodeId],
        ),
    ]);

    if (!nuskaitytojasRes.rows.length) {
        return next();
    }

    const nuskaitytojas = nuskaitytojasRes.rows[0];

    res.render("failai/ocrNode", {
        customHead: config.customHead,
        nuskaitytojas,
        ocrStatsDay: ocrStatsDayRes.rows,
        req,
    });
});

export default failaiSearchRouter;
