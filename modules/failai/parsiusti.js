/*
Parsisiunčia duomenų bazėje nurodytus failus į viešdėžes.
*/

import { postgres } from "../../postgres/postgres.js";
import { getProxyBySite } from "../scrapeProxies/getProxyBySite.js";
import config from "../../utils/config.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import Timings from "../../utils/timings.js";
import { Agent } from "undici";
import { iEile } from "./nuskaitymoEile.js";

const slowAgent = new Agent({ headersTimeout: 30 * 60_000 }); // 30 min
const nodeName = process.env.NODE_NAME || "default";

/**
 * Parsiunčia vieną neparsiųstą failą į viešdėžę.
 * @returns {Promise<boolean>} true jei pavyko parsisiųsti failą, false jei nėra failų parsisiuntimui
 */
export async function parsiustiFaila(options = {}) {
    let timings = options.timings || new Timings();

    timings.start("getFileFromBucket");

    const result = await postgres.query(
        `WITH cte AS (
            SELECT q.id FROM public."failaiParsiuntimoQueue" q
            WHERE q."lockedBy" IS NULL
            AND (
                q.state = 0
                OR (q.state = -1 AND (
                    (q.bandymai < 6   AND q."paskutinisBandymas" <= NOW() - interval '3 hours')
                    OR (q.bandymai < 30  AND q."paskutinisBandymas" <= NOW() - interval '12 hours')
                    OR (q.bandymai < 54  AND q."paskutinisBandymas" <= NOW() - interval '1 day')
                    OR q."paskutinisBandymas" <= NOW() - interval '3 days'
                ))
            )
            ORDER BY q.bandymai, q.id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        ),
        locked AS (
            UPDATE public."failaiParsiuntimoQueue" q
            SET "lockedBy" = $1,
                "lockedAt" = NOW(),
                "paskutinisBandymas" = NOW(),
                bandymai = COALESCE(q.bandymai, 0) + 1
            FROM cte WHERE q.id = cte.id
            RETURNING q.id
        )
        SELECT f.* FROM public.failai f
        WHERE f.id = (SELECT id FROM locked)`,
        [nodeName],
    );
    if (!result.rows.length) return false;
    const failas = result.rows[0];
    timings.end("getFileFromBucket");

    logger.log(`Parsiunčiamas: ${failas.id} (${failas.pavadinimas})`);

    // Randame dėžę, kuri dar turi vietos
    timings.start("getDeze");
    const dezeRes = await postgres.query(
        `
    SELECT d.*, a."apiKey"
    FROM public.dezes d
    JOIN public."apiRaktai" a ON a.id = d."apiRaktasId"
    WHERE d.used < d.max
    ORDER BY d."priority" DESC
    LIMIT 1
    `,
    );
    timings.end("getDeze");

    if (dezeRes.rows.length === 0) {
        throw new Error("Nėra dėžių parsisiuntimui.");
    }

    const deze = dezeRes.rows[0];

    try {
        // Pateikiame parsisiuntimo užklausą
        let url;
        let saltinis = failas.saltinis;
        if (!saltinis) {
            saltinis = "sutartys";
        }
        if (saltinis == "sutartys") {
            let proxy = await getProxyBySite("eviesiejipirkimai");

            if (!proxy) {
                // https://eviesiejipirkimai.lt/download.php?dok_id=$DOK_ID&file_id=$FILE_ID
                url = `https://eviesiejipirkimai.lt/download.php?dok_id=${failas.dokId}&file_id=${failas.fileId}`;
            } else {
                url =
                    proxy.url +
                    `/download.php?dok_id=${failas.dokId}&file_id=${failas.fileId}`;
            }
        } else if (saltinis == "neskelbiamosDerybos") {
            let proxy = await getProxyBySite("eviesiejipirkimai");
            if (!proxy) {
                url = `https://eviesiejipirkimai.lt/${failas.saltinioId}`;
            } else {
                url = proxy.url + `/${failas.saltinioId}`;
            }
        } else if (saltinis == "cvpIs") {
            const parts = failas.saltinioId.split("/");
            const documentId = parts[1];
            const versionId = parts[2];

            let proxy = await getProxyBySite("viesiejipirkimai");
            if (!proxy) {
                url = `${config.viesiejiPirkimaiUrl}/epps/cft/downloadDocumentVersion.do?versionId=${versionId}&documentId=${documentId}`;
            } else {
                url =
                    proxy.url +
                    `/epps/cft/downloadDocumentVersion.do?versionId=${versionId}&documentId=${documentId}`;
            }
        } else if (saltinis == "mvpAprasai") {
            let proxy = await getProxyBySite("mwEviesiejipirkimai");
            if (!proxy) {
                url = `https://mw.eviesiejipirkimai.lt/${failas.saltinioId}`;
            } else {
                url = proxy.url + `/${failas.saltinioId}`;
            }
        } else if (saltinis == "cvpp") {
            let proxy = await getProxyBySite("cvpp");
            if (!proxy) {
                throw new Error(
                    `Nerasta proxy CVPP šaltiniui. Šaltinis: ${saltinis}`,
                ); // CVPP šaltiniui proxy yra būtina
            }
            const parts = String(failas.saltinioId || "")
                .split("/")
                .filter(Boolean);
            const dvid = parts.length >= 3 ? parts[1] : parts[0];
            const lid = parts.length >= 3 ? parts[2] : parts[1];
            if (!dvid || !lid)
                throw new Error(
                    `Netinkamas CVPP saltinioId formatas: ${failas.saltinioId}`,
                );
            url = proxy.url + `/${lid}/${dvid}`;
        } else {
            throw new Error(`Nežinomas šaltinis: ${saltinis}`);
        }

        timings.start("fetchDownloadUrl");
        let response;
        const controller = new AbortController();
        const fetchTimeout = setTimeout(() => controller.abort(), 1000 * 60 * 9); // 9min
        try {
            response = await fetch(`${deze.url}/download-url`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": deze.apiKey,
                },
                redirect: "manual",
                body: JSON.stringify({
                    url,
                }),
                signal: controller.signal,
                dispatcher: slowAgent
            });
        } finally {
            clearTimeout(fetchTimeout);
        }
        timings.end("fetchDownloadUrl");

        if (!response.ok || response.status !== 200) {
            logger.log(await response.text());
            throw new Error("Nepavyko parsisiųsti failo.");
        }

        var { md5, size } = await response.json();

        if (!md5) {
            throw new Error("Nepavyko gauti failo.");
        }

        // Įterpiame į failaiDezes (columns: md5, deze, dydis) jei nėra
        timings.start("insertIntoFailaiDezes");
        await postgres.query(
            `INSERT INTO "failaiDezes" (md5, deze, dydis)
             VALUES ($1, $2, $3)
             ON CONFLICT (md5, deze) DO NOTHING`,
            [md5, deze.pavadinimas, size],
        );
        timings.end("insertIntoFailaiDezes");

        // Atnaujiname informaciją apie failą
        timings.start("updateFailas");
        await postgres.query(
            `UPDATE failai SET parsiustas = 1, md5 = $1, dydis = $2 WHERE id = $3`,
            [md5, size, failas.id],
        );
        await postgres.query(
            `DELETE FROM public."failaiParsiuntimoQueue" WHERE id = $1`,
            [failas.id],
        );
        // Parsisiuntęs failas tampa nuskaitomu
        await iEile([failas.id]);
        timings.end("updateFailas");
    } catch (error) {
        console.error("Klaida parsisiunčiant failą:", error);
        timings.start("updateFailas");
        await postgres.query(
            `UPDATE public."failaiParsiuntimoQueue"
            SET state = -1,
                "lockedBy" = NULL,
                "lockedAt" = NULL
            WHERE id = $1`,
            [failas.id],
        );
        timings.end("updateFailas");
        throw error;
    }

    logger.log(
        `Failas ${failas.pavadinimas} (${failas.id}) parsisiųstas ir atnaujintas (dydis=${size}B)`,
    );

    // Atnaujiname dėžės dydį
    timings.start("updateDezeUsage");
    let usedReq = await fetch(`${deze.url}/storage-usage`, {
        method: "GET",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": deze.apiKey,
        },
    });
    let { totalSizeBytes } = await usedReq.json();

    await postgres.query("UPDATE dezes SET used = $1 WHERE id = $2", [
        totalSizeBytes,
        deze.id,
    ]);
    timings.end("updateDezeUsage");

    logger.log(`Parsiuntimas užtruko: ${timings.humanDuration("fetchDownloadUrl")}`);
    return true;
}

// If called directly, run parsiustiFaila once
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    (async () => {
        try {
            await parsiustiFaila();
            process.exit(0);
        } catch (error) {
            console.error("Klaida:", error);
            process.exit(1);
        }
    })();
}
