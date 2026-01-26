import express from "express";
import { postgres, parsePgArray } from "../postgres/postgres.js";
import { Readable } from "stream";
import { Buffer } from "buffer";
import mime from "mime";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import config from "../utils/config.js";

const failasRouter = express.Router();

failasRouter.post("/failas/ocr/checkout", async (req, res, next) => {
    // Get the apiKey from query params
    let { apiKey, version } = req.query;

    if (!apiKey || typeof apiKey !== "string") {
        return res.status(400).send("API raktas privalomas.");
    }

    if (!version) {
        version = 1;
    }

    // Version has to be a number between 1 and 2
    version = Number(version);
    if (isNaN(version) || version < 1 || version > 2) {
        return res.status(400).send("Neteisinga versija.");
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

    if (user.rezervacijos > 500) {
        return res.status(429).send("Per daug rezervacijų.");
    }

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
        if (version == 1 || version == 2) {
            failasRes = await postgres.query(
                `WITH cte AS (
          SELECT id
          FROM failai
          WHERE ("ocrState" IS NULL OR "ocrState" = 0)
            AND "nuskaitytas" >= 6
            AND LOWER("extension") IN ('pdf', 'jpg', 'jpeg', 'png', 'bmp', 'gif', 'odg', 'webp', 'heic')
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
        }

        if (failasRes.rows.length === 0) {
            failasRes = await postgres.query(
                `WITH cte AS (
                    SELECT id
                    FROM failai
                    WHERE ("ocrState" IS NULL OR "ocrState" = 0)
                      AND "nuskaitytas" >= 6
                      AND LOWER("extension") IN ('pub', 'doc', 'odt', 'docm', 'rtf', 'pptx', 'odg', 'ppt', 'dotx', 'pages', 'ppsx', 'docx')
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
    }

    const failas = failasRes.rows[0];

    let urlParams = [];
    if (!failas.extension || String(failas.extension).toLowerCase() !== "pdf") {
        urlParams.push("convertTo=pdf");
    }

    let urlParamsString = urlParams.join("&");
    if (urlParamsString.length > 0) {
        urlParamsString = `?${urlParamsString}`;
    }

    const uri = `/${failas.md5}${urlParamsString}`;

    res.json({
        id: failas.id,
        uri,
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

    // We expect JSON body with id (int), tekstas (string[]), duration (double)
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
            "ocrLockTimestamp" = NULL
        WHERE id = $1;`,
        [id],
    );

    // Calculate counts
    const puslapiuSkaicius = Array.isArray(tekstas) ? tekstas.length : 0;
    const zodziuSkaicius = Array.isArray(tekstas)
        ? tekstas.reduce(
              (sum, page) =>
                  sum +
                  (typeof page === "string"
                      ? page.split(/\s+/).filter(Boolean).length
                      : 0),
              0,
          )
        : 0;

    // Insert into ocrRezultatai
    await postgres.query(
        `INSERT INTO "failaiOcrRezultatai"
        (failas, tekstas, node, "submitTimestamp", "lockTimestamp", duration, "puslapiuSkaicius", "zodziuSkaicius")
        VALUES ($1, $2, $3, NOW() AT TIME ZONE 'Europe/Vilnius', $4, $5, $6, $7);`,
        [
            id, // failas
            tekstas, // tekstas array
            user.pavadinimas, // node
            failas.ocrLockTimestamp, // lockTimestamp
            duration, // duration
            puslapiuSkaicius, // puslapiuSkaicius
            zodziuSkaicius, // zodziuSkaicius
        ],
    );

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
        "viespirkiai.org/failas",
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

        const { id, dokId, fileId } = req.params;

        // Check if id looks like md5
        let isMd5 = false;
        if (id && /^[a-f0-9]{32}$/.test(id)) {
            isMd5 = true;
        }

        let failasRezultatai;
        if (id && !isMd5) {
            if (isNaN(id)) {
                return next();
            }

            failasRezultatai = await postgres.query(
                'SELECT * FROM failai WHERE "id" = $1;',
                [id],
            );
        } else if (id && isMd5) {
            failasRezultatai = await postgres.query(
                'SELECT * FROM failai WHERE "md5" = $1 LIMIT 1;',
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
            [failas.id],
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

        if (failas.parent || failas.parsiustas === -5) {
            let parentRes = await postgres.query(
                "SELECT * FROM failai WHERE id = $1 LIMIT 1;",
                [failas.parent],
            );
            if (parentRes.rows.length === 0) {
                return res.status(404).send("Tėvinis failas nerastas.");
            }

            const dezeRes = await postgres.query(
                `SELECT
                f.md5,
                f.deze,
                f.dydis,
                d.url,
                d.speed
            FROM "failaiDezes" f
            JOIN dezes d ON f.deze = d.pavadinimas
            WHERE f.md5 = $1
            ORDER BY -LN(random()) / NULLIF(d.speed,0);`,
                [parentRes.rows[0].md5],
            );

            if (dezeRes.rows.length === 0) {
                return res.status(404).send("Dėžė nerasta.");
            }

            const deze = dezeRes.rows[0];

            if (
                ["zip", "7z"].includes(
                    String(parentRes.rows[0].extension).toLowerCase(),
                )
            ) {
                return res.json({
                    fileUrl: `${deze.url}/file/${parentRes.rows[0].md5}.${parentRes.rows[0].extension}?extract=${encodeURIComponent(failas.saltinioId)}`,
                    extension: failas.extension,
                    fileName: failas.pavadinimas,
                    contentType:
                        mime.getType(failas.extension) ||
                        "application/octet-stream",
                    contentLength: Number(failas.dydis) || undefined,
                });
            }

            // Provide the reverse proxy information
            return res.json({
                fileUrl: `${deze.url}/file/${parentRes.rows[0].md5}.${parentRes.rows[0].extension}`,
                extract: `${failas.saltinioId}`,
                extension: failas.extension,
                fileName: failas.pavadinimas,
                containerExtension: String(
                    parentRes.rows[0].extension,
                ).toLowerCase(),
                contentType:
                    mime.getType(failas.extension) ||
                    "application/octet-stream",
                contentLength: Number(failas.dydis) || undefined,
                headers: {
                    "x-api-key": deze.apiKey,
                },
            });
        }

        // Randame dėžę V2
        const dezeResV2 = await postgres.query(
            `SELECT
            f.md5,
            f.deze,
            f.dydis,
            d.url,
            d.speed
        FROM "failaiDezes" f
        JOIN dezes d ON f.deze = d.pavadinimas
        WHERE f.md5 = $1
        ORDER BY -LN(random()) / NULLIF(d.speed,0);`,
            [failas.md5],
        );

        if (dezeResV2.rows.length > 0) {
            const deze = dezeResV2.rows[0];
            return res.json({
                fileUrl: `${deze.url}/file/${failas.md5}.${failas.extension}`,
                extension: failas.extension,
                fileName: failas.pavadinimas,
                contentType:
                    mime.getType(failas.extension) ||
                    "application/octet-stream",
                contentLength: Number(failas.dydis) || undefined,
                headers: {
                    "x-api-key": deze.apiKey,
                },
            });
        } else {
            return res.status(404).send("Dėžė nerasta.");
        }
    },
);

failasRouter.get("/failas/:id/preview", async (req, res, next) => {
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

    let argumentai = [];
    if (!["pdf", "prn"].includes(String(failas.extension).toLowerCase())) {
        argumentai.push("convertTo=pdf");
    }

    argumentai = argumentai.join("&");

    // Parsiunčiame failą
    const fileUrl = `https://failai.viespirkiai.org/${failas.md5}?${argumentai}`;
    let failasBlob = await fetch(fileUrl);

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

    res.setHeader(
        "Content-Type",
        failasBlob.headers.get("Content-Type") || contentType,
    );

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

    const failas = failasRezultatai.rows[0];

    await aptarnautiFailą(req, res, next, failas, requestsJson);
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
        'SELECT 1 FROM "failuPasalinimai" WHERE "dokId" = $1 AND "fileId" = $2 AND salinti = true LIMIT 1;',
        [failas.dokId, failas.fileId],
    );

    const hasToBeRemoved = removalCheck.rows.length > 0;

    if (hasToBeRemoved) {
        res.status(451).render("failai/failasPasalintas", {
            customHead: config.customHead,
        });
        return;
    }

    await aptarnautiFailą(req, res, next, failas, requestsJson);
});

async function aptarnautiFailą(req, res, next, failas, requestsJson = false) {
    failas = { ...failas, ...(await fetchFailasMetadata(failas.id)) };

    if (failas?.metaduomenys?.signatures) {
        failas.metaduomenys.signatures.forEach((sig) => {
            if (sig.signerFullDistinguishedName) {
                sig.signerFullDistinguishedName =
                    sig.signerFullDistinguishedName.replace(/\d{4,}/g, "");
            }
        });
    }

    if (failas?.metaduomenys?.attachments) {
        failas.metaduomenys.attachments.forEach((attachment) => {
            if (/=\?UTF-8\?Q\?.+\?=/i.test(attachment.name)) {
                attachment.name = attachment.name.replace(
                    /=\?UTF-8\?Q\?(.+?)\?=/i,
                    (_, encoded) => {
                        // replace underscores with spaces
                        const qp = encoded.replace(/_/g, " ");
                        // convert =XX to bytes
                        const bytes = qp.replace(
                            /=([0-9A-Fa-f]{2})/g,
                            (_, hex) => String.fromCharCode(parseInt(hex, 16)),
                        );
                        // decode UTF-8 properly
                        return Buffer.from(bytes, "binary").toString("utf8");
                    },
                );
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
}

async function fetchFailasMetadata(id) {
    const [iban, jarKodai, links, emails, domains, telefonai, metaduomenys] =
        await Promise.all([
            postgres.query(
                `SELECT iban, puslapiai
       FROM "failaiIban"
       WHERE id = $1
       ORDER BY COALESCE(puslapiai[1], 9999), iban ASC`,
                [id],
            ),
            postgres.query(
                `SELECT jarKodas, puslapiai
       FROM "failaiJarKodai"
       WHERE id = $1
       ORDER BY COALESCE(puslapiai[1], 9999), jarKodas ASC`,
                [id],
            ),
            postgres.query(
                `SELECT link, puslapiai
       FROM "failaiLinks"
       WHERE id = $1
       ORDER BY COALESCE(puslapiai[1], 9999), link ASC`,
                [id],
            ),
            postgres.query(
                `SELECT email, puslapiai
       FROM "failaiEmails"
       WHERE id = $1
       ORDER BY COALESCE(puslapiai[1], 9999), email ASC`,
                [id],
            ),
            postgres.query(
                `SELECT domain
       FROM "failaiDomains"
       WHERE id = $1
       ORDER BY domain ASC`,
                [id],
            ),
            postgres.query(
                `SELECT telefonas, puslapiai
       FROM "failaiTelefonai"
       WHERE id = $1
       ORDER BY COALESCE(puslapiai[1], 9999), telefonas ASC`,
                [id],
            ),
            postgres.query(
                `SELECT metaduomenys
       FROM "failaiNuskaitymai"
       WHERE failas = $1
       ORDER BY id DESC
       LIMIT 1`,
                [id],
            ),
        ]);

    return {
        ibanNumeriai: iban.rows,
        jarKodai: jarKodai.rows,
        links: links.rows,
        emails: emails.rows,
        domains: domains.rows.map((r) => r.domain),
        telefonai: telefonai.rows,
        metaduomenys: metaduomenys.rows.length
            ? metaduomenys.rows[0].metaduomenys
            : null,
    };
}

export default failasRouter;
