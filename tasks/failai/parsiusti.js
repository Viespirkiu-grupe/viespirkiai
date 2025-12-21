/*
Parsisiunčia duomenų bazėje nurodytus failus į viešdėžes.
*/

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

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
             WHERE parsiustas = 0
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
            console.log(
                `Timeout: releasing failas ${failas.id} back to bucket`,
            );
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
export async function parsiustiFaila() {
    let startTime = Date.now();

    const failas = await getFromBucket();
    if (!failas) return false;

    log(`Parsiunčiamas: ${failas.id} (${failas.pavadinimas})`);

    let saltinis = failas.saltinis;
    if (!saltinis) {
        saltinis = "sutartys";
    }

    // Randame proxy
    const proxyRes = await postgres.query(
        `
      SELECT * FROM "sutarciuFailuParsiuntejai" WHERE enabled = true AND tipas = $1 ORDER BY RANDOM() LIMIT 1;`,
        [saltinis],
    );

    if (proxyRes.rows.length === 0) {
        throw new Error("Nėra prieinamų sutarčių failų parsisiuntimui.");
    }

    const proxy = proxyRes.rows[0];
    const customUrl = proxy.url;

    log(`Naudojama ${proxy.pavadinimas}`);

    // Randame dėžę, kuri dar turi vietos
    const dezeRes = await postgres.query(
        `SELECT * FROM dezes WHERE used < max ORDER BY "priority" DESC LIMIT 1`,
    );

    if (dezeRes.rows.length === 0) {
        throw new Error("Nėra dėžių parsisiuntimui.");
    }

    const deze = dezeRes.rows[0];

    try {
        // Pateikiame parsisiuntimo užklausą
        if (start == 0) {
            start = Date.now();
        }

        let url;
        if (saltinis == "sutartys") {
            url = customUrl
                .replace("$DOK_ID", failas.dokId)
                .replace("$FILE_ID", failas.fileId);
        } else if (saltinis == "neskelbiamosDerybos") {
            url = customUrl.replace("$saltinioId", failas.saltinioId);
        } else {
            throw new Error(`Nežinomas šaltinis: ${saltinis}`);
        }

        console.log(url);

        let response = await fetch(`${deze.url}/download-url`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-api-key": deze.apiKey,
            },
            body: JSON.stringify({
                url,
            }),
        });

        var { md5, size } = await response.json();

        if (!response.ok || !md5) {
            throw new Error("Nepavyko gauti failo.");
        }

        dydis += size;
        failai++;
        // Calculate mbps
        let duration = (Date.now() - start) / 1000;
        let mbps = (dydis / 1024 / 1024 / duration).toFixed(2);

        log(`${mbps} Mbps`);

        // Atnaujiname informaciją apie failą
        await postgres.query(
            "UPDATE failai SET parsiustas = 1, md5 = $1, dydis = $2, saugojama = $3 WHERE id = $4",
            [md5, size, deze.pavadinimas, failas.id],
        );
    } catch (error) {
        console.error("Klaida parsisiunčiant failą:", error);
        await postgres.query(
            "UPDATE failai SET parsiustas = -1 WHERE id = $1",
            [failas.id],
        );
        doneWithFile(failas.id);

        throw error;
    }

    log(
        `Failas ${failas.pavadinimas} (${failas.id}) parsisiųstas ir atnaujintas (dydis=${size}B)`,
    );

    // Atnaujiname dėžės dydį
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

    log(`Parsiuntimas užtruko: ${Date.now() - startTime} ms`);
    doneWithFile(failas.id);
    return true;
}
