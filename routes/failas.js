import express from "express";
import mime from "mime";
import config from "../utils/config.js";
import { postgres } from "../postgres/postgres.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

import {
    validateOcrApiKey,
    validateReverseProxyApiKey,
} from "../modules/failai/auth.js";
import { checkoutNextFile, buildFileUri } from "../modules/failai/ocr.js";
import {
    findFailas,
    getDezeForMd5,
    checkFailasAccessible,
    checkDokFileRemoved,
} from "../modules/failai/queries.js";
import {
    buildProxyResponse,
    streamRemoteFile,
} from "../modules/failai/proxy.js";
import { aptarnautiFailą } from "../modules/failai/aptarnavimas.js";

const failasRouter = express.Router();

function parseJsonSuffix(raw) {
    if (raw.endsWith(".json"))
        return { value: raw.slice(0, -5), requestsJson: true };
    return { value: raw, requestsJson: false };
}

failasRouter.post("/failas/ocr/checkout", async (req, res) => {
    const { apiKey, version = 1 } = req.query;

    const { user, error, message } = await validateOcrApiKey(apiKey);
    if (error) return res.status(error).send(message);

    const failas = await checkoutNextFile(user.pavadinimas, Number(version));
    if (!failas) return res.status(204).send("Nėra OCR laukiančių failų.");

    res.json({
        id: failas.id,
        uri: buildFileUri(failas),
        expires: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        extension: failas.extension,
    });
});

failasRouter.post("/failas/ocr/submit", async (req, res) => {
    const apiKey =
        req.query.apiKey ??
        (req.headers.authorization?.startsWith("Bearer ")
            ? req.headers.authorization.slice(7).trim()
            : null);

    const { user, error, message } = await validateOcrApiKey(apiKey);
    if (error) return res.status(error).send(message);

    const { id, tekstas, duration } = req.body;

    if (
        typeof id !== "number" ||
        typeof duration !== "number" ||
        !Array.isArray(tekstas) ||
        !tekstas.every((t) => typeof t === "string")
    )
        return res
            .status(400)
            .send(
                "Neteisingi arba trūkstami parametrai: id, tekstas, duration.",
            );

    const failasRes = await postgres.query(
        `SELECT * FROM failai WHERE id = $1 AND "ocrNode" = $2 AND "ocrState" = -3 LIMIT 1`,
        [id, user.pavadinimas],
    );
    if (!failasRes.rows.length)
        return res
            .status(404)
            .send("Failas nerastas arba neužrakintas šiam vartotojui.");

    const failas = failasRes.rows[0];
    const puslapiuSkaicius = tekstas.length;
    const zodziuSkaicius = tekstas.reduce(
        (sum, page) => sum + page.split(/\s+/).filter(Boolean).length,
        0,
    );

    await Promise.all([
        postgres.query(
            `UPDATE failai SET "ocrState" = 1, "nuskaitytas" = 0, "ocrLockTimestamp" = NULL WHERE id = $1`,
            [id],
        ),
        postgres.query(
            `INSERT INTO "failaiOcrRezultatai" (failas, tekstas, node, "submitTimestamp", "lockTimestamp", duration, "puslapiuSkaicius", "zodziuSkaicius")
             VALUES ($1, $2, $3, NOW() AT TIME ZONE 'Europe/Vilnius', $4, $5, $6, $7)`,
            [
                id,
                tekstas,
                user.pavadinimas,
                failas.ocrLockTimestamp,
                duration,
                puslapiuSkaicius,
                zodziuSkaicius,
            ],
        ),
        postgres.query(
            `UPDATE "ocrNuskaitytojai" SET "nuskaitytiDokumentai" = "nuskaitytiDokumentai" + 1 WHERE id = $1`,
            [user.id],
        ),
    ]);

    res.json({ status: "ok" });
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
        const { error, message } = await validateReverseProxyApiKey(
            req.headers["authorization"],
        );
        if (error) return res.status(error).send(message);

        const result = await findFailas(req.params);
        if (!result?.rows.length) return next();
        const failas = result.rows[0];

        const { error: accessError, message: accessMessage } =
            await checkFailasAccessible(failas);
        if (accessError) return res.status(accessError).send(accessMessage);

        if (failas.parent || failas.parsiustas === -5) {
            const parentRes = await postgres.query(
                `SELECT * FROM failai WHERE id = $1 LIMIT 1`,
                [failas.parent],
            );
            if (!parentRes.rows.length)
                return res.status(404).send("Tėvinis failas nerastas.");

            const deze = await getDezeForMd5(parentRes.rows[0].md5);
            if (!deze) return res.status(404).send("Dėžė nerasta.");

            return res.json(
                buildProxyResponse(failas, deze, parentRes.rows[0]),
            );
        }

        const deze = await getDezeForMd5(failas.md5);
        if (!deze) return res.status(404).send("Dėžė nerasta.");

        return res.json(buildProxyResponse(failas, deze));
    },
);

failasRouter.get("/failas/:id/preview", async (req, res, next) => {
    if (isNaN(req.params.id)) return next();

    const result = await postgres.query(
        `SELECT * FROM failai WHERE "id" = $1 LIMIT 1`,
        [req.params.id],
    );
    if (!result.rows.length) return next();
    const failas = result.rows[0];

    const { error, message } = await checkFailasAccessible(failas);
    if (error) return res.status(error).send(message);

    const needsConversion = !["pdf", "prn"].includes(
        String(failas.extension).toLowerCase(),
    );
    await streamRemoteFile(
        res,
        `https://failai.viespirkiai.org/${failas.md5}${needsConversion ? "?convertTo=pdf" : ""}`,
        {
            contentType:
                mime.getType(failas.extension) || "application/octet-stream",
            contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(failas.pavadinimas)}`,
        },
    );
});

failasRouter.get("/failas/:dokId/:fileId", async (req, res, next) => {
    const { value: dokId } = parseJsonSuffix(req.params.dokId);
    const { value: fileId, requestsJson } = parseJsonSuffix(req.params.fileId);

    if (isNaN(dokId) || isNaN(fileId)) return next();

    const result = await postgres.query(
        `SELECT * FROM failai WHERE "dokId" = $1 AND "fileId" = $2 LIMIT 1`,
        [dokId, fileId],
    );
    if (!result.rows.length) return next();

    if (await checkDokFileRemoved(dokId, fileId))
        return res.status(451).render("failai/failasPasalintas", {
            customHead: config.customHead,
        });

    return res.redirect(
        301,
        `/failas/${result.rows[0].id}${requestsJson ? ".json" : ""}`,
    );
});

failasRouter.get("/failas/:id", async (req, res, next) => {
    const { value: id, requestsJson } = parseJsonSuffix(req.params.id);

    if (isNaN(id)) return next();

    const result = await postgres.query(
        `SELECT * FROM failai WHERE "id" = $1 LIMIT 1`,
        [id],
    );
    if (!result.rows.length) return next();
    const failas = result.rows[0];

    if (await checkDokFileRemoved(failas.dokId, failas.fileId))
        return res.status(451).render("failai/failasPasalintas", {
            customHead: config.customHead,
        });

    return aptarnautiFailą(req, res, next, failas, requestsJson);
});

export default failasRouter;
