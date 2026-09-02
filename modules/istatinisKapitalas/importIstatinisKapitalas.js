#!/usr/bin/env node
/*
Importuoja įstatinį kapitalą tiesiai iš data.gov.lt API į Postgres su puslapiavimu
https://data.gov.lt/datasets/1570/
*/
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("istatinisKapitalas", { operation: "importIstatinisKapitalas" });
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import config from "../../utils/config.js";

const BASE = `${config.dataGovUrl}/datasets/gov/rc/jar/ja_kapitalas/JuridinisAsmuoKapitalas`;
const LIMIT = 10_000;
const BATCH_SIZE = 100;

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

let totalInserted = 0;
let pageNr = 1;

async function main() {
    let nextPage = null;

    while (true) {
        const data = await fetchPage(nextPage);

        if (!data._data || data._data.length === 0) {
            log("Baigta. Daugiau duomenų nėra.");
            break;
        }

        log(`→ Page ${pageNr}: ${data._data.length} įrašų`);

        let batch = [];

        for (const obj of data._data) {
            batch.push([
                obj.juridinis_asmuo?._id ?? null, // jarId
                obj.forma?._id ?? null, // formaId
                obj.data_nuo ?? null, // data
                obj.reiksme ?? null, // reiksme
                obj.valiuta ?? null, // valiuta
            ]);

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

    log("DONE. Iš viso įterpta:", totalInserted);
}

async function insertBatch(rows) {
    if (rows.length === 0) return;

    const numColumns = rows[0].length;

    const placeholders = rows
        .map((_, rowIndex) => {
            const start = rowIndex * numColumns + 1;
            return `(${Array.from(
                { length: numColumns },
                (_, colIndex) => `$${start + colIndex}`,
            ).join(", ")})`;
        })
        .join(", ");

    const sql = `
        INSERT INTO "rcJar"."spintaKapitalas" (
            "jarId", "formaId", "data", "reiksme", "valiuta"
        )
        VALUES ${placeholders}
        ON CONFLICT ("jarId", "data", "reiksme") DO NOTHING
    `;

    try {
        await postgres.query(sql, rows.flat());
        totalInserted += rows.length;

        if (totalInserted % 1000 === 0) {
            log(`Inserted ${totalInserted}`);
        }
    } catch (err) {
        console.error(`Insert failed at ${totalInserted} rows:`, err.message);
        throw err;
    }
}

await main();
await postgres.end();
