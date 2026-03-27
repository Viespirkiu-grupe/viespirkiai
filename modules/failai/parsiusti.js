/*
Parsisiunčia duomenų bazėje nurodytus failus į viešdėžes.
*/

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import Timings from "../../utils/timings.js";

let kibirelis = [];
const BUCKET_SIZE = 50;
const REFILL_THRESHOLD = 5;
const inProgress = new Map();
const bucketIds = new Set();

let filling = false;

/**
 * Užpildo kibirėlį naujais failais iš duomenų bazės.
 * Jei kibirėlis jau pilnas arba užpildymo procesas vyksta, funkcija nieko nedaro.
 * @returns {Promise<void>}
 */
async function fillBucket() {
    if (filling) return;
    filling = true;

    try {
        const limit = BUCKET_SIZE - kibirelis.length;
        if (limit <= 0) return;

        const res = await postgres.query(
            `SELECT *
             FROM failai
             WHERE parsiustas = 0 OR ((parsiustas = -1 OR parsiustas IS NULL)
               AND (
                   "parsiuntimoBandymai" IS NULL
                   OR "paskutinisParsiuntimoBandymas" IS NULL
                   OR (
                       COALESCE("parsiuntimoBandymai", 0) < 6
                       AND "paskutinisParsiuntimoBandymas" <= (now() AT TIME ZONE 'Europe/Vilnius') - interval '1 hour'
                   )
                   OR (
                       COALESCE("parsiuntimoBandymai", 0) >= 6
                       AND COALESCE("parsiuntimoBandymai", 0) < 30
                       AND "paskutinisParsiuntimoBandymas" <= (now() AT TIME ZONE 'Europe/Vilnius') - interval '3 hours'
                   )
                   OR (
                       COALESCE("parsiuntimoBandymai", 0) >= 30
                       AND COALESCE("parsiuntimoBandymai", 0) < 54
                       AND "paskutinisParsiuntimoBandymas" <= (now() AT TIME ZONE 'Europe/Vilnius') - interval '1 day'
                   )
                   OR (
                       COALESCE("parsiuntimoBandymai", 0) >= 54
                       AND "paskutinisParsiuntimoBandymas" <= (now() AT TIME ZONE 'Europe/Vilnius') - interval '3 days'
                   )
               ))
             ORDER BY id DESC
             LIMIT $1`,
            [limit * 2],
        );

        for (const row of res.rows) {
            if (!bucketIds.has(row.id) && !inProgress.has(row.id)) {
                kibirelis.push(row);
                bucketIds.add(row.id);
                if (kibirelis.length >= BUCKET_SIZE) break;
            }
        }
    } finally {
        filling = false;
    }
}

/**
 * Paima vieną failą iš kibirėlio.
 * Jei kibirėlis tuščias, užpildo jį naujais failais.
 * @returns {Promise<Object|null>} Failo objektas arba null, jei nėra failų.
 */
async function getFromBucket() {
    if (kibirelis.length < REFILL_THRESHOLD) {
        await fillBucket(); // refill async
    }

    const failas = kibirelis.shift();
    if (!failas) return null;

    bucketIds.delete(failas.id);

    // mark in progresskibirelis
    const timeout = setTimeout(
        () => {
            log(`Timeout: releasing failas ${failas.id} back to bucket`);
            if (!bucketIds.has(failas.id)) {
                kibirelis.push(failas);
                bucketIds.add(failas.id);
            }
            inProgress.delete(failas.id);
        },
        10 * 60 * 1000,
    );

    inProgress.set(failas.id, timeout);

    return failas;
}

/**
 * Pažymi failą kaip baigtą ir pašalina jį iš in-progress sąrašo.
 * @param {number} failasId - Failo ID.
 */
function doneWithFile(failasId) {
    const timeout = inProgress.get(failasId);
    if (timeout) {
        clearTimeout(timeout);
        inProgress.delete(failasId);
    }
}

let failai = 0;
let dydis = 0;
let start = 0;

/**
 * Parsiunčia vieną neparsiųstą failą į viešdėžę.
 * @returns {Promise<boolean>} true jei pavyko parsisiųsti failą, false jei nėra failų parsisiuntimui
 */
export async function parsiustiFaila(options = {}) {
    let timings = options.timings || new Timings();

    timings.start("getFileFromBucket");
    const failas = await getFromBucket();
    timings.end("getFileFromBucket");
    if (!failas) return false;

    log(`Parsiunčiamas: ${failas.id} (${failas.pavadinimas})`);

    // Randame dėžę, kuri dar turi vietos
    timings.start("getDeze");
    const dezeRes = await postgres.query(
        `SELECT * FROM dezes WHERE used < max ORDER BY "priority" DESC LIMIT 1`,
    );
    timings.end("getDeze");

    if (dezeRes.rows.length === 0) {
        throw new Error("Nėra dėžių parsisiuntimui.");
    }

    const deze = dezeRes.rows[0];

    try {
        // Pateikiame parsisiuntimo užklausą
        if (start == 0) {
            start = Date.now();
        }

        async function getProxyBySite() {
            timings.start("getProxyBySite");
            const proxyRes = await postgres.query(
                `SELECT * FROM "scrapeProxies" WHERE enabled = true AND site = $1 AND type = 'httpReverse'`,
                [saltinis],
            );
            if (proxyRes.rows.length === 0) {
                return null;
            }
            timings.end("getProxyBySite");
            return proxyRes.rows[
                Math.floor(Math.random() * proxyRes.rows.length)
            ];
        }

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
                url = `https://viesiejipirkimai.lt/epps/cft/downloadDocumentVersion.do?versionId=${versionId}&documentId=${documentId}`;
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
            const [dvid, lid] = failas.saltinioId.split("/");
            url = proxy.url + `/${lid}/${dvid}`;
        } else {
            throw new Error(`Nežinomas šaltinis: ${saltinis}`);
        }

        timings.start("fetchDownloadUrl");
        let response = await fetch(`${deze.url}/download-url`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": deze.apiKey,
            },
            redirect: "manual",
            body: JSON.stringify({
                url,
            }),
        });
        timings.end("fetchDownloadUrl");

        if (!response.ok || response.status !== 200) {
            log(await response.text());
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
            "UPDATE failai SET parsiustas = 1, md5 = $1, dydis = $2 WHERE id = $3",
            [md5, size, failas.id],
        );
        timings.end("updateFailas");
    } catch (error) {
        console.error("Klaida parsisiunčiant failą:", error);
        timings.start("updateFailas");
        await postgres.query(
            `UPDATE failai
             SET parsiustas = -1,
                 "parsiuntimoBandymai" = COALESCE("parsiuntimoBandymai", 0) + 1,
                 "paskutinisParsiuntimoBandymas" = (now() AT TIME ZONE 'Europe/Vilnius')
             WHERE id = $1`,
            [failas.id],
        );
        timings.end("updateFailas");
        doneWithFile(failas.id);

        throw error;
    }

    log(
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

    log(`Parsiuntimas užtruko: ${timings.humanDuration("fetchDownloadUrl")}`);
    doneWithFile(failas.id);
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
