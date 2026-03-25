import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { Worker } from "worker_threads";
import { fileURLToPath } from "url";
import { postgres } from "../postgres/postgres.js";
import {
    searchJar,
    findSingleJuridinis,
} from "../modules/juridiniai/search.js";

const juridiniaiRouter = express.Router();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;
const TILE_SIZE = 256;
const OVERSAMPLE = 4;

const TILE_WORKER_PATH = fileURLToPath(
    new URL("../utils/tileWorker.js", import.meta.url),
);

/**
 * Offloads canvas tile rendering to a worker thread.
 * @param {object[]} rows
 * @param {{ TILE_SIZE: number, scale: number, minTileX: number, minTileY: number }} opts
 * @returns {Promise<Buffer>}
 */
function renderTile(rows, opts) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(TILE_WORKER_PATH, {
            workerData: { rows, ...opts },
        });
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", (code) => {
            if (code !== 0)
                reject(new Error(`Tile worker exited with code ${code}`));
        });
    });
}

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
 * @param {object} query
 * @returns {string}
 */
function buildQueryParams(query) {
    if (query.search) return `&search=${encodeURIComponent(query.search)}`;
    if (query.location && query.locationRadius) {
        const [lat, lon] = query.location.split(",");
        return `&location=${lat},${lon}&locationRadius=${query.locationRadius}`;
    }
    if (query.adresas) return `&adresas=${encodeURIComponent(query.adresas)}`;
    return "&";
}

/**
 * @param {{ results: object[], total: number, elapsed: number, searchEngine: string }} params
 * @returns {string}
 */
function buildNumberOfResults({ results, total, elapsed, searchEngine }) {
    const trukme = (elapsed / 1000).toFixed(2) + "s";
    const source = `<pre style="display: inline;">(${trukme}, ${searchEngine})</pre>`;
    if (results.length < total)
        return `Rodomi ${results.length} iš ${total} rezultatų ${source}`;
    return `${total} rezultatas(-ai) ${source}`;
}

/**
 * @param {express.Response} res
 * @param {object[]} results
 */
function serveJsonl(res, results) {
    res.setHeader("Content-Type", "application/x-ndjson");
    res.setHeader(
        "Content-Disposition",
        `attachment; filename=viespirkiai-${new Date().toISOString()}.jsonl`,
    );
    for (const item of results) res.write(JSON.stringify(item) + "\n");
    res.end();
}

/**
 * @param {express.Response} res
 * @param {object[]} results
 */
function serveCsv(res, results) {
    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
        "Content-Disposition",
        `attachment; filename=viespirkiai-${new Date().toISOString()}.csv`,
    );
    res.write(Object.keys(results[0]).join(",") + "\n");
    for (const item of results) {
        delete item.adresoId;
        res.write(
            Object.values(item)
                .map((v) => `"${`${v ?? ""}`.replace(/"/g, '""')}"`)
                .join(",") + "\n",
        );
    }
    res.end();
}

juridiniaiRouter.get("/juridiniai", cleanEmptyQueryParams, async (req, res) => {
    const parsedLimit = parseLimit(req.query);
    if ("error" in parsedLimit) return res.status(400).send(parsedLimit.error);
    const { limit } = parsedLimit;

    const page = parseInt(req.query.page) || 1;
    const hasSearch =
        req.query.search ||
        (req.query.location && req.query.locationRadius) ||
        req.query.adresas;

    if (!hasSearch)
        return res.render("juridiniai/index", {
            customHead: config.customHead,
            values: {},
            req,
            usedHiddenFields: false,
        });

    const startas = performance.now();
    const { results, total, searchEngine } = await searchJar(req.query, {
        page,
    });

    if (req.query.json) return res.json(results);
    if (req.query.jsonl) return serveJsonl(res, results);
    if (req.query.csv) return serveCsv(res, results);

    const numberOfResults = buildNumberOfResults({
        results,
        total,
        elapsed: performance.now() - startas,
        searchEngine,
    });
    const queryParams = buildQueryParams(req.query);
    const galimaEksportuoti = total > 0 && total <= MAX_LIMIT;
    const view = req.query.tikRezultatai
        ? "juridiniai/results"
        : "juridiniai/index";

    res.render(view, {
        customHead: config.customHead,
        values: req.query,
        data: results,
        queryParams,
        numberOfResults,
        currentPage: page,
        pageCount: Math.ceil(total / limit),
        galimaEksportuoti,
        req,
        usedHiddenFields: false,
    });
});

juridiniaiRouter.get("/juridiniai.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "",
        "Juridinių asmenų paieška",
        "",
        "viespirkiai.org/juridiniai",
    );
});

juridiniaiRouter.get("/juridiniai/map/tiles/:z/:x/:y.png", async (req, res) => {
    const z = parseInt(req.params.z);
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);

    const scale = 2 ** OVERSAMPLE;
    const minTileX = x * scale;
    const maxTileX = minTileX + scale - 1;
    const minTileY = y * scale;
    const maxTileY = minTileY + scale - 1;

    const { rows } = await postgres.query(
        `SELECT "tileX", "tileY", "pointCount"
         FROM public."jarCsvLocationTiles"
         WHERE "zoom" = $1 AND "tileX" BETWEEN $2 AND $3 AND "tileY" BETWEEN $4 AND $5`,
        [z + OVERSAMPLE, minTileX, maxTileX, minTileY, maxTileY],
    );

    // Render PNG in a worker thread to keep the event loop free
    const buffer = await renderTile(rows, { TILE_SIZE, scale, minTileX, minTileY });

    res.setHeader("Content-Type", "image/png");
    res.end(buffer);
});

juridiniaiRouter.get("/juridiniai/map/viewport", async (req, res) => {
    const minLat = parseFloat(req.query.minLat);
    const minLon = parseFloat(req.query.minLon);
    const maxLat = parseFloat(req.query.maxLat);
    const maxLon = parseFloat(req.query.maxLon);

    if ([minLat, minLon, maxLat, maxLon].some(Number.isNaN))
        return res.status(400).send("Invalid viewport bounds");

    const { rows } = await postgres.query(
        `SELECT DISTINCT ST_Y(location) AS lat, ST_X(location) AS lon
         FROM public."jarCsv"
         WHERE location IS NOT NULL
           AND ST_X(location) BETWEEN $1 AND $2
           AND ST_Y(location) BETWEEN $3 AND $4`,
        [minLon, maxLon, minLat, maxLat],
    );

    res.json({ locations: rows.map((r) => [r.lat, r.lon]) });
});

juridiniaiRouter.get("/juridiniai/topAdresai", async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const offset = (page - 1) * DEFAULT_LIMIT;
    const startas = performance.now();

    const [adresaiRes, countRes] = await Promise.all([
        postgres.query(
            `SELECT * FROM "jarCsvTopAdresai" ORDER BY count DESC LIMIT $1 OFFSET $2`,
            [DEFAULT_LIMIT, offset],
        ),
        postgres.query(`SELECT COUNT(*) AS total FROM "jarCsvTopAdresai"`),
    ]);

    const total = parseInt(countRes.rows[0].total, 10);
    const elapsed = performance.now() - startas;
    const trukme = (elapsed / 1000).toFixed(2) + "s";
    const source = `<pre style="display: inline;">(${trukme}, PostgreSQL)</pre>`;
    const numberOfResults =
        adresaiRes.rowCount < total
            ? `Rodomi ${adresaiRes.rowCount} iš ${Number(total).linksniuotiK(["rezultato", "rezultatų"])} ${source}`
            : `${Number(total).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} ${source}`;

    res.render("juridiniai/topAdresai", {
        customHead: config.customHead,
        adresai: adresaiRes.rows,
        totalAdresaiCount: total,
        numberOfResults,
        currentPage: page,
        pageCount: Math.ceil(total / DEFAULT_LIMIT),
        req,
        queryParams: "",
    });
});

juridiniaiRouter.get("/juridiniai/match", async (req, res) => {
    const { q, similarityThreshold } = req.query;
    if (!q)
        return res.status(400).json({ error: "Missing query parameter: q" });

    const result = await findSingleJuridinis(q, {
        similarityThreshold: similarityThreshold
            ? Number(similarityThreshold)
            : undefined,
    });

    if (!result) return res.status(404).json(null);
    res.json(result);
});

export default juridiniaiRouter;
