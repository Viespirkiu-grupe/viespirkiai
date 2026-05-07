import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { objectsToCsvStream } from "../utils/csv.js";
import { objectsToJsonlStream } from "../utils/jsonl.js";
import { Transform } from "node:stream";
import Timings from "../utils/timings.js";
import {
    searchSutartys,
    countSutartys,
} from "../modules/sutartys/searchSutartys.js";

const indexRouter = express.Router();

let analizeModule = null;
async function getAnalizeModule() {
    if (!analizeModule) analizeModule = await import("../modules/sutartys/analize.js");
    return analizeModule;
}

const DEFAULT_LIMIT = 50;
const MAX_TYPESENSE_LIMIT = 5_000;
const MAX_POSTGRES_LIMIT = 1_000_000;

/**
 * @param {object} query
 * @returns {{ limit: number } | { error: string }}
 */
function parseLimit(query) {
    const hasSearch = !!query.search;
    if (query.limit === "max")
        return { limit: hasSearch ? MAX_TYPESENSE_LIMIT : MAX_POSTGRES_LIMIT };
    const n = parseInt(query.limit);
    if (hasSearch && n > MAX_TYPESENSE_LIMIT)
        return {
            error: `Limitas per didelis. Maksimalus limitas tekstinėms paieškoms po ${MAX_TYPESENSE_LIMIT} rezultatų puslapyje.`,
        };
    if (n > MAX_POSTGRES_LIMIT)
        return {
            error: `Limitas per didelis. Maksimalus limitas ne tekstinėms paieškoms yra ${MAX_POSTGRES_LIMIT} rezultatų puslapyje.`,
        };
    if (n > 0) return { limit: n };
    return { limit: DEFAULT_LIMIT };
}

/**
 * @param {{ shown: number, total: number | null, elapsed: number, engine: string, limit: number }} params
 * @returns {{ numberOfResults: string, total: number }}
 */
function buildNumberOfResults({ shown, total, elapsed, engine }) {
    const trukme = (elapsed / 1000).toFixed(2) + "s";
    const source = `<span class="inline">(${trukme}, ${engine})</span>`;
    if (total == null) {
        return {
            numberOfResults: `${Number(shown).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} ${source}`,
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
    "Tipas",
    "Kategorija",
    "Pavadinimas",
    "Numatyta vertė",
    "Faktinė vertė",
    "Pirkėjo pavadinimas",
    "Pirkėjo kodas",
    "Tiekėjų pavadinimai",
    "Tiekėjų kodai",
    "Sudarymo data",
    "Faktinė įvykdymo data",
    "Redagavimo data",
    "BVPZ kodai",
    "Sutarties numeris",
    "Unikalus ID",
];

/**
 * @param {object} r
 * @returns {Record<string, unknown>}
 */
function resultToCsvObject(r) {
    const fmt = (v) => (v ? v.toString().slice(0, 10) : "");
    return {
        Tipas: r.tipas,
        Kategorija: r.kategorija,
        Pavadinimas: r.pavadinimas,
        "Numatyta vertė": r.verte,
        "Faktinė vertė": r.faktineVerte || "",
        "Pirkėjo pavadinimas": r.perkanciojiOrganizacija,
        "Pirkėjo kodas": r.perkanciosiosOrganizacijosKodas,
        "Tiekėjų pavadinimai": r.tiekejai.join("; "),
        "Tiekėjų kodai": r.tiekejaiKodai.join("; "),
        "Sudarymo data": fmt(r.sudarymoData),
        "Faktinė įvykdymo data": fmt(r.faktineIvykdymoData),
        "Redagavimo data": fmt(r.paskutinioRedagavimoData),
        "BVPZ kodai": r.bvpzKodai.join("; ") || "",
        "Sutarties numeris": r.sutartiesNumeris || "",
        "Unikalus ID": r.sutartiesUnikalusId,
    };
}

async function serveCsvStream(res, stream, client) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
        "Content-Disposition",
        `attachment; filename=viespirkiai-${new Date().toISOString()}.csv`,
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
        if (client) {
            client.release();
        }
    });
}

async function serveJsonlStream(res, stream, client) {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader(
        "Content-Disposition",
        `attachment; filename=viespirkiai-${new Date().toISOString()}.jsonl`,
    );

    stream.pipe(objectsToJsonlStream()).pipe(res);

    await new Promise((resolve, reject) => {
        res.on("finish", resolve);
        res.on("error", reject);
        stream.on("error", reject);
    }).finally(() => {
        if (client) {
            client.release();
        }
    });
}

indexRouter.get("/", cleanEmptyQueryParams, async (req, res, next) => {
    const timings = new Timings();
    timings.start("req");

    const parsedLimit = parseLimit(req.query);
    if ("error" in parsedLimit) return res.status(400).send(parsedLimit.error);
    const { limit } = parsedLimit;
    const page = parseInt(req.query.page) || 1;
    const engine =
        req.query.search && config.typesenseUp ? "typesense" : "postgres";

    if (req.query.csv || req.query.jsonl) {
        timings.start("stream");

        const { stream, client, values, queryParams } = await searchSutartys(
            req.query,
            { limit: null, page, stream: true, sort: false, engine },
        );
        timings.end("stream");

        if (req.query.jsonl) return serveJsonlStream(res, stream, client);
        if (req.query.csv) return serveCsvStream(res, stream, client);
    }

    if (req.query.rezultatuSkaiciausPatikslinimas) {
        const startas = performance.now();
        const [total, { values, queryParams }] = await Promise.all([
            countSutartys(req.query),
            searchSutartys(req.query, { limit: 1, page, engine }),
        ]);
        const elapsed =
            performance.now() - startas + Number(req.query.trukme || 0);
        const { numberOfResults } = buildNumberOfResults({
            shown: limit,
            total,
            elapsed,
            engine,
            limit,
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

    timings.start(engine);
    const startas = performance.now();
    const { results, total, values, queryParams } = await searchSutartys(
        req.query,
        { limit, page, engine },
    );
    timings.end(engine);

    const elapsed = performance.now() - startas + Number(req.query.trukme || 0);
    const { numberOfResults } = buildNumberOfResults({
        shown: results.length,
        total,
        elapsed,
        engine,
        limit,
    });

    if (req.query.json) {
        const analizeMod = req.query.analize ? await getAnalizeModule() : null;
        return res.json({
            results,
            analize: analizeMod ? analizeMod.buildAnalize(results) : undefined,
        });
    }

    const analizeMod = req.query.analize ? await getAnalizeModule() : null;
    const analize = analizeMod ? analizeMod.buildAnalize(results) : undefined;

    if (analize && req.query.xlsx) {
        const buf = await analizeMod.buildAnalizeXlsx(analize, results);
        res.setHeader(
            "Content-Disposition",
            `attachment; filename=viespirkiai-analize-${new Date().toISOString()}.xlsx`,
        );
        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        );
        return res.send(buf);
    }

    let galimaEksportuoti =
        engine === "typesense"
            ? total <= MAX_TYPESENSE_LIMIT
            : total <= MAX_POSTGRES_LIMIT;

    res.set("Cache-Control", "private, max-age=10, s-maxage=10");
    res.setHeader("Server-Timing", timings.serverTiming());

    if (Object.keys(values).length == 0) {
        galimaEksportuoti = false;
    }
    values.limit = limit;

    res.renderCompiled("sutartys/index", {
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
                k !== "limit" &&
                values[k] !== "" &&
                values[k] !== undefined,
        ),
        req,
        analize,
    });
});

indexRouter.get("/index.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Pirkimų skelbimų paieška",
        "Viešpirkiai",
        "",
        "viespirkiai.org",
    );
});

indexRouter.get("/sutartys.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Sutarčių paieška",
        "Viešpirkiai",
        "Viešųjų pirkimų sutartys ir jų informacija",
        "viespirkiai.org/sutartys",
    );
});

export default indexRouter;
