import express from "express";
import cleanEmptyQueryParams from "../utils/queryParams.js";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { createCanvas } from "canvas";
import { postgres } from "../postgres/postgres.js";
import { searchJar } from "../modules/juridiniai/search.js";
import { findSingleJuridinis } from "../modules/juridiniai/search.js";

const juridiniaiRouter = express.Router();

juridiniaiRouter.get("/juridiniai", cleanEmptyQueryParams, async (req, res) => {
    const startas = performance.now();

    const page = parseInt(req.query.page) || 1;
    let limit = 50;

    const MAX_LIMIT = 250;
    if (req.query.limit == "max") {
        limit = MAX_LIMIT;
    } else if (parseInt(req.query.limit) > MAX_LIMIT) {
        return res
            .status(400)
            .send(`Limitas per didelis. Maksimalus limitas yra ${MAX_LIMIT}.`);
    } else if (parseInt(req.query.limit) > 0) {
        limit = parseInt(req.query.limit) || limit;
    }

    if (
        req.query.search ||
        (req.query.location && req.query.locationRadius) ||
        req.query.adresas
    ) {
        // Use the refactored function
        const { results, total, searchEngine } = await searchJar(req.query, {
            page,
        });

        // Build queryParams for pagination/links outside the function
        let queryParams = "&";
        if (req.query.search) {
            queryParams += `search=${encodeURIComponent(req.query.search)}`;
        } else if (req.query.location && req.query.locationRadius) {
            const [lat, lon] = req.query.location.split(",");
            queryParams += `&location=${lat},${lon}&locationRadius=${req.query.locationRadius}`;
        } else if (req.query.adresas) {
            queryParams += `&adresas=${encodeURIComponent(req.query.adresas)}`;
        }

        if (req.query.json) {
            return res.json(results);
        }

        // Jei prašoma JSONL
        if (req.query.jsonl) {
            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename=viespirkiai-${new Date().toISOString()}.jsonl`,
            );

            results.forEach((item) => {
                res.write(JSON.stringify(item) + "\n");
            });
            return res.end();
        }

        // Jei prašoma CSV
        if (req.query.csv) {
            res.setHeader("Content-Type", "text/csv");
            res.setHeader(
                "Content-Disposition",
                `attachment; filename=viespirkiai-${new Date().toISOString()}.csv`,
            );
            const csvHeader = Object.keys(results[0]).join(",") + "\n";
            res.write(csvHeader);
            results.forEach((item) => {
                delete item.adresoId;
                const csvRow =
                    Object.values(item)
                        .map(
                            (value) =>
                                `"${`${value ?? ""}`.replace(/"/g, '""')}"`,
                        )
                        .join(",") + "\n";
                res.write(csvRow);
            });
            return res.end();
        }

        // Paieškos užklausos informacija
        let trukme = ((performance.now() - startas) / 1000).toFixed(2) + "s";
        let rodomiRezultatai = results.length;
        if (rodomiRezultatai < total) {
            var numberOfResults = `Rodomi ${rodomiRezultatai} iš ${total} rezultatų <pre style="display: inline;">(${trukme}, ${searchEngine})</pre>`;
        } else {
            var numberOfResults = `${total} rezultatas(-ai) <pre style="display: inline;">(${trukme}, ${searchEngine})</pre>`;
        }

        let galimaEksportuoti = total > 0 && total <= MAX_LIMIT;

        if (req.query.tikRezultatai) {
            res.render("juridiniai/results", {
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
            return;
        }

        res.render("juridiniai/index", {
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
    } else {
        res.render("juridiniai/index", {
            customHead: config.customHead,
            values: {},
            req,
            usedHiddenFields: false,
        });
    }
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

const TILE_SIZE = 256;
const OVERSAMPLE = 4; // draw z+2 tiles inside the z tile

juridiniaiRouter.get("/juridiniai/map/tiles/:z/:x/:y.png", async (req, res) => {
    const z = parseInt(req.params.z);
    const x = parseInt(req.params.x);
    const y = parseInt(req.params.y);

    const targetZoom = z + OVERSAMPLE;
    const scale = 2 ** OVERSAMPLE; // number of subtiles per tile

    const minTileX = x * scale;
    const maxTileX = minTileX + scale - 1;
    const minTileY = y * scale;
    const maxTileY = minTileY + scale - 1;

    try {
        const { rows } = await postgres.query(
            `
            SELECT "tileX", "tileY", "pointCount"
            FROM public."jarCsvLocationTiles"
            WHERE "zoom" = $1
              AND "tileX" BETWEEN $2 AND $3
              AND "tileY" BETWEEN $4 AND $5
            `,
            [targetZoom, minTileX, maxTileX, minTileY, maxTileY],
        );

        const canvas = createCanvas(TILE_SIZE, TILE_SIZE);
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);

        const maxCount = Math.max(...rows.map((r) => r.pointCount), 1);

        for (const row of rows) {
            // fractional position inside the tile (0–1)
            const fx = (row.tileX - minTileX) / scale;
            const fy = (row.tileY - minTileY) / scale;

            const fw = 1 / scale;
            const fh = 1 / scale;

            // scale to 256x256
            const px = fx * TILE_SIZE;
            const py = fy * TILE_SIZE;
            const pw = fw * TILE_SIZE;
            const ph = fh * TILE_SIZE;

            const intensity =
                Math.log10(row.pointCount + 1) / Math.log10(maxCount + 1);

            const green = Math.round(255 * (1 - intensity));
            ctx.fillStyle = `rgba(255,${green},0,${Math.min(Math.max(intensity, 0), 1)})`;

            ctx.fillRect(px, py, pw, ph);
        }

        res.setHeader("Content-Type", "image/png");
        canvas.pngStream().pipe(res);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error generating tile");
    }
});

juridiniaiRouter.get("/juridiniai/map/viewport", async (req, res) => {
    try {
        const minLat = parseFloat(req.query.minLat);
        const minLon = parseFloat(req.query.minLon);
        const maxLat = parseFloat(req.query.maxLat);
        const maxLon = parseFloat(req.query.maxLon);

        if (
            Number.isNaN(minLat) ||
            Number.isNaN(minLon) ||
            Number.isNaN(maxLat) ||
            Number.isNaN(maxLon)
        ) {
            return res.status(400).send("Invalid viewport bounds");
        }

        // Get distinct coordinates
        const { rows } = await postgres.query(
            `
            SELECT DISTINCT ST_Y(location) AS lat, ST_X(location) AS lon
            FROM public."jarCsv"
            WHERE location IS NOT NULL
              AND ST_X(location) BETWEEN $1 AND $2
              AND ST_Y(location) BETWEEN $3 AND $4
            `,
            [minLon, maxLon, minLat, maxLat],
        );

        // Return as array of [lat, lon]
        const locations = rows.map((r) => [r.lat, r.lon]);
        res.json({ locations });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error fetching points");
    }
});

juridiniaiRouter.get("/juridiniai/topAdresai", async (req, res) => {
    let page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;

    let start = performance.now();
    let adresaiRes = await postgres.query(
        `
        SELECT *
        FROM "jarCsvTopAdresai"
        ORDER BY count DESC
        LIMIT $1 OFFSET $2
    `,
        [limit, offset],
    );

    let adresaiCountRes = await postgres.query(`
        SELECT COUNT(*) AS total
        FROM "jarCsvTopAdresai"
    `);
    let end = performance.now();

    const trukme = ((end - start) / 1000).toFixed(2) + "s";
    const rodomiRezultatai = adresaiRes.rowCount;
    const numberOfResults =
        rodomiRezultatai < parseInt(adresaiCountRes.rows[0].total)
            ? `Rodomi ${rodomiRezultatai} iš ${Number(adresaiCountRes.rows[0].total).linksniuotiK(["rezultato", "rezultatų"])} <pre style="display: inline;">(${trukme}, PostgreSQL)</pre>`
            : `${Number(adresaiCountRes.rows[0].total).linksniuoti(["rezultatas", "rezultatai", "rezultatų"])} <pre style="display: inline;">(${trukme}, PostgreSQL)</pre>`;

    let adresai = adresaiRes.rows;
    let totalAdresaiCount = parseInt(adresaiCountRes.rows[0].total);

    res.render("juridiniai/topAdresai", {
        adresai,
        totalAdresaiCount,
        numberOfResults,
        customHead: config.customHead,
        currentPage: page,
        pageCount: Math.ceil(totalAdresaiCount / limit),
        req,
        queryParams: "",
    });
});

juridiniaiRouter.get("/juridiniai/match", async (req, res) => {
    try {
        const { q, similarityThreshold } = req.query;

        if (!q) {
            return res
                .status(400)
                .json({ error: "Missing query parameter: q" });
        }

        const result = await findSingleJuridinis(q, {
            similarityThreshold: similarityThreshold
                ? Number(similarityThreshold)
                : undefined,
        });

        if (!result) {
            return res.status(404).json(null);
        }

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default juridiniaiRouter;
