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
import {
    paimtiParsiuntimui,
    pazymetiKlaida,
    pazymetiParsiusta,
} from "./parsiuntimoEile.js";

const slowAgent = new Agent({ headersTimeout: 30 * 60_000 }); // 30 min
const nodeName = process.env.NODE_NAME || "default";

/** Sujungia dėžės url su keliu — dėžės url gali turėti brūkšnį gale (pvz. lempa2). */
function dezesUrl(baseUrl, pathname) {
    return `${baseUrl.replace(/\/+$/, "")}${pathname}`;
}

/**
 * Parsiunčia vieną neparsiųstą failą į viešdėžę.
 * @returns {Promise<boolean>} true jei pavyko parsisiųsti failą, false jei nėra failų parsisiuntimui
 */
export async function parsiustiFaila(options = {}) {
    let timings = options.timings || new Timings();

    timings.start("getFileFromBucket");

    // Migracijos metu imama iš abiejų eilių — pirmenybė senajai (žr. parsiuntimoEile.js)
    const failas = await paimtiParsiuntimui(nodeName);
    if (!failas) return false;
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
            response = await fetch(dezesUrl(deze.url, "/download-url"), {
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

        // Dėžės įrašas, failo būsena ir eilė
        timings.start("updateFailas");
        await pazymetiParsiusta({
            id: failas.id,
            md5,
            dydis: size,
            dezeId: deze.id,
            extension: failas.extension,
        });
        // Parsisiuntęs failas tampa nuskaitomu
        await iEile([failas.id]);
        timings.end("updateFailas");
    } catch (error) {
        console.error("Klaida parsisiunčiant failą:", error);
        timings.start("updateFailas");
        await pazymetiKlaida(failas.id);
        timings.end("updateFailas");
        throw error;
    }

    logger.log(
        `Failas ${failas.pavadinimas} (${failas.id}) parsisiųstas ir atnaujintas (dydis=${size}B)`,
    );

    // Atnaujiname dėžės dydį
    timings.start("updateDezeUsage");
    let usedReq = await fetch(dezesUrl(deze.url, "/storage-usage"), {
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
