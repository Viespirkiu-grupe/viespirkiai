import express from "express";
import { postgres } from "../postgres/postgres.js";
import { Readable } from "stream";
import mime from "mime";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import config from "../utils/config.js";

const failasRouter = express.Router();

failasRouter.get("/failas.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Failai",
        "Failų parsisiuntimo statistika",
        "",
        "viespirkiai.top/failas",
    );
});

failasRouter.get("/failas/:dokId/:fileId/download", async (req, res, next) => {
    let { dokId, fileId } = req.params;

    // Check if both arguments are numbers
    if (isNaN(dokId) || isNaN(fileId)) {
        return next();
    }

    // Randame failą
    const failasRezultatai = await postgres.query(
        'SELECT * FROM failai WHERE "dokId" = $1 AND "fileId" = $2;',
        [dokId, fileId],
    );

    // 404
    if (failasRezultatai.rows.length === 0) {
        return next();
    }

    const failas = failasRezultatai.rows[0];

    const removalCheck = await postgres.query(
        'SELECT 1 FROM "failuPasalinimai" WHERE "dokId" = $1 AND "fileId" = $2 AND salinti = true LIMIT 1;',
        [dokId, fileId],
    );

    const hasToBeRemoved = removalCheck.rows.length > 0;

    if (hasToBeRemoved) {
        return res
            .status(451)
            .send("Failas pašalintas. Removed for legal reasons.");
    }

    // Patikriname, ar failas yra parsiųstas
    if (failas.parsiustas === 0) {
        return res.status(404).send("Failas dar neparsiųstas.");
    }

    if (failas.parsiustas === -1) {
        return res.status(404).send("Failas nepavykęs parsiųsti.");
    }

    const dezeRes = await postgres.query(
        "SELECT * FROM dezes WHERE pavadinimas = $1 LIMIT 1",
        [failas.saugojama],
    );

    if (dezeRes.rows.length === 0) {
        return res.status(404).send("Dėžė nerasta.");
    }

    const deze = dezeRes.rows[0];

    // Parsiunčiame failą
    const fileUrl = `${deze.url}/file/${failas.md5}.${failas.extension}`;
    let failasBlob = await fetch(fileUrl, {
        headers: {
            "x-api-key": deze.apiKey,
        },
    });

    if (!failasBlob.ok) {
        return res.status(500).send("Nepavyko gauti failo.");
    }

    // Instruct the browser and CDN to cache
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");

    // Nustatome failo pavadinimą, prašome atvaizduoti naršyklėje
    res.setHeader(
        "Content-Disposition",
        `inline; filename*=UTF-8''${encodeURIComponent(failas.pavadinimas)}`,
    );

    // Nustatome failo tipą
    const contentType =
        mime.getType(failas.extension) || "application/octet-stream";

    res.setHeader("Content-Type", contentType);

    const contentLength = Number(failas.dydis);
    if (!Number.isNaN(contentLength)) {
        res.setHeader("Content-Length", contentLength);
    }

    // Persiunčiame failą
    const nodeStream = Readable.fromWeb(failasBlob.body);
    nodeStream.on("error", (err) => {
        console.error("Stream error:", err);
        if (!res.headersSent) {
            res.status(500).send("Error streaming file.");
        } else {
            res.destroy(err);
        }
    });

    nodeStream.pipe(res);
});

failasRouter.get("/failas/:dokId/:fileId", async (req, res, next) => {
    let { dokId, fileId } = req.params;

    let requestsJson = false;
    if (fileId.endsWith(".json")) {
        fileId = fileId.slice(0, -5);
        requestsJson = true;
    }

    // Check if both arguments are numbers
    if (isNaN(dokId) || isNaN(fileId)) {
        return next();
    }

    // Randame failą
    const failasRezultatai = await postgres.query(
        'SELECT * FROM failai WHERE "dokId" = $1 AND "fileId" = $2 LIMIT 1;',
        [dokId, fileId],
    );

    // 404
    if (failasRezultatai.rows.length === 0) {
        return next();
    }

    const failas = failasRezultatai.rows[0];

    const removalCheck = await postgres.query(
        'SELECT 1 FROM "failuPasalinimai" WHERE "dokId" = $1 AND "fileId" = $2 AND salinti = true LIMIT 1;',
        [dokId, fileId],
    );

    const hasToBeRemoved = removalCheck.rows.length > 0;

    if (hasToBeRemoved) {
        res.status(451).render("failai/failasPasalintas", {
            customHead: config.customHead,
        });
        return;
    }

    delete failas.saugojama;

    if (requestsJson) {
        return res.json(failas);
    }

    res.render("failai/failas", {
        customHead: config.customHead,
        failas,
        query: req.query,
    });
});

export default failasRouter;
