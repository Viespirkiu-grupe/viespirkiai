#!/usr/bin/env node
/*
Importuoja mokėtų mokesčių duomenis tiesiai iš data.gov.lt API į Postgres
https://data.gov.lt/datasets/673/
*/
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("vmi", { operation: "importMoketiMokesciai" });
import { postgres } from "../../postgres/postgres.js";
import { paruostiEilute, irasytiMokescius } from "./mokesciai.js";
import { log } from "../../utils/log.js";
import config from "../../utils/config.js";

const BASE = `${config.dataGovUrl}/datasets/gov/vmi/ja_mokesciai/Moketojas`;
const LIMIT = 10_000;
const BATCH_SIZE = 200;

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

let totalProcessed = 0;
let pageNr = 1;

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

    log("DONE. Iš viso apdorota:", totalProcessed);
}

async function insertBatch(rows) {
    if (rows.length === 0) return;

    try {
        await irasytiMokescius(rows);
        totalProcessed += rows.length;

        if (totalProcessed % 1000 === 0) {
            log(`Processed ${totalProcessed}`);
        }
    } catch (err) {
        console.error(`Insert failed at ${totalProcessed} rows:`, err.message);
        throw err;
    }
}

await main();
await postgres.end();
