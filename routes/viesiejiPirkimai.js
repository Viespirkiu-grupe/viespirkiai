import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { objectsToCsvStream } from "../utils/csv.js";
import { objectsToJsonlStream } from "../utils/jsonl.js";
import { Transform } from "node:stream";
import Timings from "../utils/timings.js";
import {
    searchViesiejiPirkimai,
    countViesiejiPirkimai,
} from "../modules/viesiejiPirkimai/searchViesiejiPirkimai.js";
import {
    STATUSAS,
    PIRKIMO_BUDAS,
} from "../modules/viesiejiPirkimai/viesiejiPirkimaiEnums.js";
import { buildTedNoticeViewModel } from "../modules/ted/viewer.js";
import { postgres } from "../postgres/postgres.js";
import { searchSutartys } from "../modules/sutartys/searchSutartys.js";

const viesiejiPirkimaiRouter = express.Router();

const DEFAULT_LIMIT = 50;
const MAX_POSTGRES_LIMIT = 1_000_000;

/**
 * @param {object} query
 * @returns {{ limit: number } | { error: string }}
 */
function parseLimit(query) {
    if (query.limit === "max") return { limit: MAX_POSTGRES_LIMIT };
    const n = parseInt(query.limit);
    if (n > MAX_POSTGRES_LIMIT)
        return {
            error: `Limitas per didelis. Maksimalus limitas yra ${MAX_POSTGRES_LIMIT} rezultatų puslapyje.`,
        };
    if (n > 0) return { limit: n };
    return { limit: DEFAULT_LIMIT };
}

/**
 * @param {{ shown: number, total: number | null, elapsed: number, limit: number }} params
 * @returns {{ numberOfResults: string, total: number }}
 */
function buildNumberOfResults({ shown, total, elapsed }) {
    const trukme = (elapsed / 1000).toFixed(2) + "s";
    const source = `<pre style="display: inline;">(${trukme}, postgres)</pre>`;
    if (total == null) {
        return {
            numberOfResults: `Rodomi ${shown} iš <span class="rezultatai-nezinomas-total"> ? </span> rezultatų <pre style="display: inline;"> (${trukme}, postgres)</pre>`,
            total: 10_000,
        };
    }
    if (shown < total)
        return {
            numberOfResults: `Rodomi ${shown} iš ${Number(total).linksniuotiK(["rezultato", "rezultatų"])} ${source}`,
            total,
        };
    return {
        numberOfResults: `${Number(total).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} ${source}`,
        total,
    };
}

const CSV_HEADERS = [
    "Pirkimo ID",
    "Pavadinimas",
    "Vykdytojas",
    "Paskelbimo data",
    "Pasiūlymų terminas",
    "Pirkimo būdas",
    "Statusas",
    "Žingsnis",
    "Numatoma vertė",
    "Tipas",
];

/**
 * @param {object} r
 * @returns {Record<string, unknown>}
 */
function resultToCsvObject(r) {
    const fmt = (v) => (v ? String(v).slice(0, 10) : "");
    return {
        "Pirkimo ID": r.pirkimoId,
        Pavadinimas: r.pavadinimas,
        Vykdytojas: r.pirkimoVykdytojas,
        "Paskelbimo data": fmt(r.paskelbimoData),
        "Pasiūlymų terminas": r.pasiulymuPateikimoTerminas
            ? String(r.pasiulymuPateikimoTerminas)
                  .slice(0, 16)
                  .replace("T", " ")
            : "",
        "Pirkimo būdas": r.pirkimoBudas,
        Statusas: r.statusas,
        Žingsnis: r.zingsnis,
        "Numatoma vertė": r.numatomaBendraPirkimoVerte ?? "",
        Tipas: r.type,
    };
}

async function serveCsvStream(res, stream, client) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
        "Content-Disposition",
        `attachment; filename=viesieji-pirkimai-${new Date().toISOString()}.csv`,
    );
    res.setHeader("Content-Transfer-Encoding", "binary");

    stream
        .pipe(
            new Transform({
                objectMode: true,
                transform(row, _enc, cb) {
                    cb(null, resultToCsvObject(row));
                },
            }),
        )
        .pipe(objectsToCsvStream())
        .pipe(res);

    await new Promise((resolve, reject) => {
        res.on("finish", resolve);
        res.on("error", reject);
        stream.on("error", reject);
    }).finally(() => {
        if (client) client.release();
    });
}

async function serveJsonlStream(res, stream, client) {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader(
        "Content-Disposition",
        `attachment; filename=viesieji-pirkimai-${new Date().toISOString()}.jsonl`,
    );

    stream.pipe(objectsToJsonlStream()).pipe(res);

    await new Promise((resolve, reject) => {
        res.on("finish", resolve);
        res.on("error", reject);
        stream.on("error", reject);
    }).finally(() => {
        if (client) client.release();
    });
}

viesiejiPirkimaiRouter.get(
    "/viesiejiPirkimai",
    cleanEmptyQueryParams,
    async (req, res, next) => {
        const timings = new Timings();
        timings.start("req");

        const parsedLimit = parseLimit(req.query);
        if ("error" in parsedLimit)
            return res.status(400).send(parsedLimit.error);
        const { limit } = parsedLimit;
        const page = parseInt(req.query.page) || 1;

        if (req.query.csv || req.query.jsonl) {
            timings.start("stream");
            const { stream, client } = await searchViesiejiPirkimai(req.query, {
                limit: null,
                page,
                stream: true,
                sort: false,
            });
            timings.end("stream");

            if (req.query.jsonl) return serveJsonlStream(res, stream, client);
            if (req.query.csv) return serveCsvStream(res, stream, client);
        }

        if (req.query.rezultatuSkaiciausPatikslinimas) {
            const startas = performance.now();
            const [total, { values, queryParams }] = await Promise.all([
                countViesiejiPirkimai(req.query),
                searchViesiejiPirkimai(req.query, { limit: 1, page }),
            ]);
            const elapsed =
                performance.now() - startas + Number(req.query.trukme || 0);
            const { numberOfResults } = buildNumberOfResults({
                shown: limit,
                total,
                elapsed,
            });
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
                    res.json({ total, numberOfResults, pagination: html });
                },
            );
        }

        timings.start("postgres");
        const startas = performance.now();
        const { results, total, values, queryParams } =
            await searchViesiejiPirkimai(req.query, { limit, page });
        timings.end("postgres");

        const elapsed =
            performance.now() - startas + Number(req.query.trukme || 0);
        const { numberOfResults } = buildNumberOfResults({
            shown: results.length,
            total,
            elapsed,
        });

        if (req.query.json) return res.json({ results });

        const galimaEksportuoti =
            Object.keys(values).length > 0 &&
            (total ?? 0) <= MAX_POSTGRES_LIMIT;

        res.set("Cache-Control", "private, max-age=10, s-maxage=10");
        res.setHeader("Server-Timing", timings.serverTiming());

        res.renderCompiled("viesiejiPirkimai/index", {
            data: results,
            values,
            currentPage: page,
            pageCount: Math.ceil((total || 100_000) / limit),
            numberOfResults,
            queryParams,
            customHead: config.customHead,
            galimaEksportuoti,
            usedHiddenFields: Object.keys(values).some(
                (k) =>
                    k !== "search" &&
                    values[k] !== "" &&
                    values[k] !== undefined,
            ),
            req,
            STATUSAS,
            PIRKIMO_BUDAS,
        });
    },
);

viesiejiPirkimaiRouter.get("/viesiejiPirkimai/:id", async (req, res, next) => {
    const id = req.params.id.replace(/\.json$/, "");
    const isJson = req.params.id.endsWith(".json");
    const { rows } = await postgres.query(
        `
        SELECT p.*, v.pavadinimas AS "vykdytojoPavadinimas", v."jarKodas"
        FROM public."viesiejiPirkimai" p
        LEFT JOIN public."viesiejiPirkimaiVykdytojai" v ON v.id = p."pirkimoVykdytojasId"
        WHERE p."pirkimoId" = $1
        `,
        [id],
    );
    const pirkimas = rows[0];
    if (!pirkimas) return res.status(404).render("404");

    const failai = pirkimas.turinys?.failai ?? [];
    const saltinioIds = failai.flatMap((failas) =>
        (failas.versijos ?? []).map(
            (v) => `${id}/${failas.dokumentasId}/${v.versionId}`,
        ),
    );

    if (saltinioIds.length) {
        const { rows: failaiRows } = await postgres.query(
            `SELECT * FROM public."failai"
             WHERE saltinis = 'cvpIs' AND "saltinioId" = ANY($1)`,
            [saltinioIds],
        );
        const lokalusFailai = Object.fromEntries(
            failaiRows.map((f) => [f.saltinioId, f]),
        );
        for (const failas of failai) {
            for (const versija of failas.versijos ?? []) {
                const saltinioId = `${id}/${failas.dokumentasId}/${versija.versionId}`;
                const lokalus = lokalusFailai[saltinioId];
                if (lokalus) {
                    const {
                        id,
                        filename,
                        extension,
                        parsiustas,
                        nuskaitytas,
                        zodziuSkaicius,
                        puslapiuSkaicius,
                        dydis,
                        md5,
                    } = lokalus;
                    Object.assign(versija, {
                        id,
                        filename,
                        extension,
                        parsiustas,
                        nuskaitytas,
                        zodziuSkaicius,
                        puslapiuSkaicius,
                        dydis,
                        md5,
                    });
                }
            }
        }
    }

    // Normalize skelbimai.downloadHref to absolute URLs (used by file cards in the view)
    if (
        pirkimas?.turinys?.skelbimai &&
        Array.isArray(pirkimas.turinys.skelbimai)
    ) {
        pirkimas.turinys.skelbimai = pirkimas.turinys.skelbimai.map((s) => {
            if (!s || typeof s !== "object") return s;

            const raw = s.downloadHref;
            if (!raw || typeof raw !== "string") return s;

            const href = raw.trim();
            if (!href) return s;

            // Keep absolute URLs as-is
            if (/^https?:\/\//i.test(href)) return s;

            // Convert relative → absolute
            const path = href.startsWith("/") ? href : `/${href}`;
            return {
                ...s,
                downloadHref: `https://viesiejipirkimai.lt${path}`,
            };
        });
    }

    // Build TED notice cards that point to internal viewer when parsed content exists.
    if (Array.isArray(pirkimas?.turinys?.tedNuorodosIPaskelbtusPranesimus)) {
        const tedUrls = pirkimas.turinys.tedNuorodosIPaskelbtusPranesimus.filter(
            (u) => typeof u === "string" && u.trim().length > 0,
        );
        pirkimas.turinys.tedSkelbimai = [];
        pirkimas.turinys.tedNuorodosIsorines = [];

        const parseTedNoticeNumber = (url) => {
            const trimmed = String(url).trim();
            const noticeMatch = trimmed.match(/NOTICE:(\d+-\d{4})/i);
            if (noticeMatch?.[1]) return noticeMatch[1];

            const fallbackMatch = trimmed.match(/(\d{4,}-\d{4})/);
            return fallbackMatch?.[1] || null;
        };

        const tedNoticeNumbers = [
            ...new Set(
                tedUrls
                    .map((url) => parseTedNoticeNumber(url))
                    .filter(Boolean),
            ),
        ];

        if (tedNoticeNumbers.length > 0) {
            const { rows: tedRows } = await postgres.query(
                `SELECT "tedNoticeNumber", turinys
                 FROM public."tedNotices"
                 WHERE "tedNoticeNumber" = ANY($1)
                   AND turinys IS NOT NULL`,
                [tedNoticeNumbers],
            );

            const availableNotices = new Map(
                tedRows.map((r) => [r.tedNoticeNumber, r.turinys]),
            );

            tedUrls.forEach((url) => {
                    const tedNoticeNumber = parseTedNoticeNumber(url);
                    if (!tedNoticeNumber || !availableNotices.has(tedNoticeNumber)) {
                        pirkimas.turinys.tedNuorodosIsorines.push(url);
                        return;
                    }

                    let pavadinimas = "TED skelbimas";
                    const tedTurinys = availableNotices.get(tedNoticeNumber);
                    if (tedTurinys) {
                        try {
                            const tedView = buildTedNoticeViewModel(tedTurinys);
                            pavadinimas =
                                tedView?.documentTypeLabel ||
                                tedView?.subTypeDescription ||
                                pavadinimas;
                        } catch {
                            // Keep a generic title if XML parsing fails.
                        }
                    }

                    pirkimas.turinys.tedSkelbimai.push({
                        pavadinimas,
                        numeris: tedNoticeNumber,
                        downloadHref: `/ted/${tedNoticeNumber}`,
                        originalHref: url,
                    });
                });
        } else {
            pirkimas.turinys.tedSkelbimai = [];
            pirkimas.turinys.tedNuorodosIsorines = tedUrls;
        }
    }

    let sutartysRes = await searchSutartys({
        pirkimoNumeris: pirkimas.pirkimoId,
    });

    pirkimas.sutartys = sutartysRes.results;

    if (isJson) return res.json(pirkimas);

    res.renderCompiled("viesiejiPirkimai/pirkimas", {
        pirkimas,
        customHead: config.customHead,
        req,
    });
});

viesiejiPirkimaiRouter.get("/viesiejiPirkimai.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Viešųjų pirkimų paieška",
        "Viešpirkiai",
        "",
        "viespirkiai.org",
    );
});

export default viesiejiPirkimaiRouter;
