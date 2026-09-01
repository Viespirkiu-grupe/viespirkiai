#!/usr/bin/env node
/*
Importuoja Užimtumo tarnybos darbo vietas tiesiai iš API į PostgreSQL (uzt schema)
https://data.gov.lt/datasets/2894/
*/
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("uzimtumoTarnyba", { operation: "importUZT" });
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import config from "../../utils/config.js";
import { paruostiEilute } from "./darboVietosEilute.js";
import { irasytiDarboVietas } from "./darboVietos.js";

const BASE = `${config.dataGovUrl}/datasets/gov/uzt/ldv/Vieta`;
const LIMIT = 100_000;
const BATCH_SIZE = 1000;

let totalProcessed = 0;
let pageNr = 1;

async function fetchPage(pageToken = null) {
    const params = [`limit(${LIMIT})`];
    if (pageToken) params.push(`page("${pageToken}")`);

    const url = `${BASE}?${params.join("&")}`;
    const res = await scrapeFetch(url);
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    return res.json();
}

async function insertBatch(rows) {
    if (rows.length === 0) return;

    try {
        await irasytiDarboVietas(rows);
        totalProcessed += rows.length;
        log(`Importuota ${totalProcessed} įrašų`);
    } catch (err) {
        console.error(
            `Įterpimas nepavyko po ${totalProcessed} įrašų:`,
            err.message,
        );
        throw err;
    }
}

async function main() {
    let nextPage = null;

    while (true) {
        const data = await fetchPage(nextPage);

        if (!data._data || data._data.length === 0) {
            log("Baigta. Daugiau duomenų nėra.");
            break;
        }

        log(`Page ${pageNr}: ${data._data.length} įrašų`);

        let batch = [];

        for (const obj of data._data) {
            batch.push(paruostiEilute(obj));

            if (batch.length === BATCH_SIZE) {
                await insertBatch(batch);
                batch = [];
            }
        }

        if (batch.length > 0) {
            await insertBatch(batch);
        }

        nextPage = data._page?.next;
        if (!nextPage) break;

        pageNr++;
    }

    log(`DONE. Iš viso apdorota: ${totalProcessed}`);
}

await main();
await postgres.end();
