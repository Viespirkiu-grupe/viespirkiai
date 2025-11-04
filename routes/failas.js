import express from "express";
import { postgres, parsePgArray } from "../postgres/postgres.js";
import { Readable } from "stream";
import mime from "mime";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import config from "../utils/config.js";

const failasRouter = express.Router();

failasRouter.post("/failas/ocr/checkout", async (req, res, next) => {
    // Get the apiKey from query params
    const { apiKey } = req.query;

    if (!apiKey || typeof apiKey !== "string") {
        return res.status(400).send("API raktas privalomas.");
    }

    // Check if the apiKey exists in the database
    const userRes = await postgres.query(
        `SELECT * FROM "ocrNuskaitytojai" WHERE "apiKey" = $1 LIMIT 1;`,
        [apiKey],
    );
    if (userRes.rows.length === 0) {
        return res.status(403).send("Neteisingas API raktas.");
    }

    const user = userRes.rows[0];

    // Gauname 1 failą SELECT * FROM failai WHERE "ocrState" = 0; ir atnaujiname jo būseną į -3
    // Kad kiti nepasiimtų to paties failo, naudojame RETURNING
    var failasRes = await postgres.query(
        `WITH cte AS (
          SELECT id
          FROM failai
          WHERE "ocrState" = 0
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE failai
       SET "ocrState" = -3,
           "ocrNode" = $1,
           "ocrLockTimestamp" = (NOW() AT TIME ZONE 'Europe/Vilnius')
       WHERE id IN (SELECT id FROM cte)
       RETURNING *;`,
        [user.pavadinimas],
    );

    if (failasRes.rows.length === 0) {
        failasRes = await postgres.query(
            `WITH cte AS (
          SELECT id
          FROM failai
          WHERE "ocrState" IS NULL
            AND "nuskaitytas" >= 6
            AND "extension" = 'pdf'
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE failai
        SET "ocrState" = -3,
            "ocrNode" = $1,
            "ocrLockTimestamp" = (NOW() AT TIME ZONE 'Europe/Vilnius')
        WHERE id IN (SELECT id FROM cte)
        RETURNING *;`,
            [user.pavadinimas],
        );

        if (failasRes.rows.length === 0) {
            return res.status(204).send("Nėra OCR laukiančių failų.");
        }
    }

    const failas = failasRes.rows[0];

    res.json({
        id: failas.id,
        uri: `/${failas.dokId}/${failas.fileId}/`,
        expires: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        extension: failas.extension,
    });
});

failasRouter.post("/failas/ocr/submit", async (req, res, next) => {
    // Get the apiKey from query params
    const { apiKey } = req.query;

    if (!apiKey || typeof apiKey !== "string") {
        return res.status(400).send("API raktas privalomas.");
    }

    // Check if the apiKey exists in the database
    const userRes = await postgres.query(
        `SELECT * FROM "ocrNuskaitytojai" WHERE "apiKey" = $1 LIMIT 1;`,
        [apiKey],
    );
    if (userRes.rows.length === 0) {
        return res.status(403).send("Neteisingas API raktas.");
    }

    const user = userRes.rows[0];

    // We expect JSON body with id (int), tekstas[string], duration[double]
    const { id, tekstas, duration } = req.body;

    if (
        typeof id !== "number" ||
        typeof tekstas !== "object" ||
        typeof duration !== "number"
    ) {
        return res
            .status(400)
            .send(
                "Neteisingi arba trūkstami parametrai: id, tekstas, duration.",
            );
    }

    // Find the file by id and check if it's locked by this user
    const failasRes = await postgres.query(
        `SELECT * FROM failai WHERE id = $1 AND "ocrNode" = $2 AND "ocrState" = -3 LIMIT 1;`,
        [id, user.pavadinimas],
    );

    if (failasRes.rows.length === 0) {
        return res
            .status(404)
            .send("Failas nerastas arba neužrakintas šiam vartotojui.");
    }

    const failas = failasRes.rows[0];

    /*
    "ocrState" integer, → 1
    "ocrText" text COLLATE pg_catalog."default", → JSON.stringify(tekstas), limit to 1MB actual size
    "ocrLockTimestamp" timestamp without time zone, → null
    "ocrDuration" double precision → duration
    nuskaitytas to 0
    */

    await postgres.query(
        `UPDATE failai
        SET "ocrState" = 1,
            "nuskaitytas" = 0,
            "ocrText" = LEFT($1, 1048576),
            "ocrLockTimestamp" = NULL,
            "ocrDuration" = $2,
            "ocrTimestamp" = (NOW() AT TIME ZONE 'Europe/Vilnius')
        WHERE id = $3;`,
        [tekstas, duration, id],
    );
    //             "nuskaitytas" = 0

    // Increment user's processed count
    await postgres.query(
        `UPDATE "ocrNuskaitytojai"
        SET "nuskaitytiDokumentai" = "nuskaitytiDokumentai" + 1
        WHERE id = $1;`,
        [user.id],
    );

    res.json({
        status: "ok",
    });
});

failasRouter.get("/failas.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Failai",
        "Failų parsisiuntimo statistika",
        "",
        "viespirkiai.top/failas",
    );
});

failasRouter.get(
    [
        "/failas/:id/downloadProxyInformation",
        "/failas/:dokId/:fileId/downloadProxyInformation",
    ],
    async (req, res, next) => {
        // Get the apiKey from Authorization headers
        const authHeader = req.headers["authorization"];
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(400).send("API raktas privalomas.");
        }

        const apiKey = authHeader.slice(7); // Remove 'Bearer ' prefix

        // Check if the apiKey exists in the database
        const reverseProxyRes = await postgres.query(
            `SELECT * FROM "reverseProxies" WHERE "apiKey" = $1 LIMIT 1;`,
            [apiKey],
        );
        if (reverseProxyRes.rows.length === 0) {
            return res.status(403).send("Neteisingas API raktas.");
        }

        const reverseProxy = reverseProxyRes.rows[0];

        const { id, dokId, fileId } = req.params;

        let finalId;
        let failasRezultatai;
        if (id) {
            if (isNaN(id)) {
                return next();
            }

            failasRezultatai = await postgres.query(
                'SELECT * FROM failai WHERE "id" = $1;',
                [id],
            );
        } else if (dokId && fileId) {
            if (isNaN(dokId) || isNaN(fileId)) {
                return next();
            }

            failasRezultatai = await postgres.query(
                'SELECT * FROM failai WHERE "dokId" = $1 AND "fileId" = $2 LIMIT 1;',
                [dokId, fileId],
            );
        } else {
            return res.status(400).send("Neteisingi parametrai");
        }

        // 404
        if (failasRezultatai.rows.length === 0) {
            return next();
        }

        const failas = failasRezultatai.rows[0];

        const removalCheck = await postgres.query(
            'SELECT 1 FROM "failuPasalinimai" WHERE "failoId" = $1 AND salinti = true LIMIT 1;',
            [id],
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

        // Randame dėžę

        const dezeRes = await postgres.query(
            "SELECT * FROM dezes WHERE pavadinimas = $1 LIMIT 1",
            [failas.saugojama],
        );

        if (dezeRes.rows.length === 0) {
            return res.status(404).send("Dėžė nerasta.");
        }

        const deze = dezeRes.rows[0];

        // Provide the reverse proxy information
        res.json({
            fileUrl: `${deze.url}/file/${failas.md5}.${failas.extension}`,
            extension: failas.extension,
            fileName: failas.pavadinimas,
            contentType:
                mime.getType(failas.extension) || "application/octet-stream",
            contentLength: Number(failas.dydis) || undefined,
            headers: {
                "x-api-key": deze.apiKey,
            },
        });
    },
);

failasRouter.get("/failas/:id/download", async (req, res, next) => {
    let { id } = req.params;

    if (isNaN(id)) {
        return next();
    }

    // Randame failą
    const failasRezultatai = await postgres.query(
        'SELECT * FROM failai WHERE "id" = $1;',
        [id],
    );

    // 404
    if (failasRezultatai.rows.length === 0) {
        return next();
    }

    const failas = failasRezultatai.rows[0];

    const removalCheck = await postgres.query(
        'SELECT 1 FROM "failuPasalinimai" WHERE "failoId" = $1 AND salinti = true LIMIT 1;',
        [id],
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
        console.error("Failed to fetch file:", failasBlob.statusText);
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
        console.error("Failed to fetch file:", failasBlob.statusText);
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

    if (failas?.metaduomenys?.signatures) {
        failas.metaduomenys.signatures.forEach((sig) => {
            if (sig.signerFullDistinguishedName) {
                sig.signerFullDistinguishedName =
                    sig.signerFullDistinguishedName.replace(/\d{4,}/g, "");
            }
        });
    }

    if (failas?.ocrText) {
        failas.ocrText = parsePgArray(failas.ocrText);
    }

    if (requestsJson) {
        return res.json(failas);
    }

    res.render("failai/failas", {
        customHead: config.customHead,
        failas,
        query: req.query,
    });
});

failasRouter.get("/failas/:id", async (req, res, next) => {
    let { id } = req.params;

    let requestsJson = false;
    if (id.endsWith(".json")) {
        id = id.slice(0, -5);
        requestsJson = true;
    }

    if (isNaN(id)) {
        return next();
    }

    // Randame failą
    const failasRezultatai = await postgres.query(
        'SELECT * FROM failai WHERE "id" = $1 LIMIT 1;',
        [id],
    );

    // 404
    if (failasRezultatai.rows.length === 0) {
        return next();
    }

    const failas = failasRezultatai.rows[0];

    const removalCheck = await postgres.query(
        'SELECT 1 FROM "failuPasalinimai" WHERE "failoId" = $1 AND salinti = true LIMIT 1;',
        [id],
    );

    const hasToBeRemoved = removalCheck.rows.length > 0;

    if (hasToBeRemoved) {
        res.status(451).render("failai/failasPasalintas", {
            customHead: config.customHead,
        });
        return;
    }

    delete failas.saugojama;

    if (failas?.metaduomenys?.signatures) {
        failas.metaduomenys.signatures.forEach((sig) => {
            if (sig.signerFullDistinguishedName) {
                sig.signerFullDistinguishedName =
                    sig.signerFullDistinguishedName.replace(/\d{4,}/g, "");
            }
        });
    }

    if (failas?.ocrText) {
        failas.ocrText = parsePgArray(failas.ocrText);
    }

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
