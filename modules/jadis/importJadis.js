#!/usr/bin/env node
/*
Importuoja JADIS dalyvių duomenis tiesiai iš data.gov.lt API į PostgreSQL
https://data.gov.lt/datasets/1732/
*/
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const BASE = "https://get.data.gov.lt/datasets/gov/rc/jadis/dalyviai/Dalyvis";
const LIMIT = 10_000;
const BATCH_SIZE = 200;

async function fetchPage(pageToken = null) {
    const params = [`limit(${LIMIT})`];
    if (pageToken) params.push(`page("${pageToken}")`);

    const url = `${BASE}?${params.join("&")}`;
    const res = await fetch(url);

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

        log(`Page ${pageNr}: ${data._data.length} records`);

        let batch = [];

        for (const obj of data._data) {
            batch.push([
                obj.juridinis_asmuo?._id ?? null, // jarId
                obj.form_kodas?._id ?? null, // formaId
                obj.stat_statusas?._id ?? null, // statusasId
                obj.lr_fiziniai ?? null, // lrFiziniai
                obj.lr_juridiniai ?? null, // lrJuridiniai
                obj.uzsienio_fiziniai ?? null, // uzsienioFiziniai
                obj.uzsienio_juridiniai ?? null, // uzsienioJuridiniai
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

    log("DONE. Iš viso apdorota:", totalInserted);
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
        INSERT INTO "jadis" (
            "jarId", "formaId", "statusasId",
            "lrFiziniai", "lrJuridiniai",
            "uzsienioFiziniai", "uzsienioJuridiniai"
        )
        VALUES ${placeholders}
        ON CONFLICT ("jarId") DO UPDATE SET
            "formaId" = EXCLUDED."formaId",
            "statusasId" = EXCLUDED."statusasId",
            "lrFiziniai" = EXCLUDED."lrFiziniai",
            "lrJuridiniai" = EXCLUDED."lrJuridiniai",
            "uzsienioFiziniai" = EXCLUDED."uzsienioFiziniai",
            "uzsienioJuridiniai" = EXCLUDED."uzsienioJuridiniai"
    `;

    try {
        await postgres.query(sql, rows.flat());
        totalInserted += rows.length;

        if (totalInserted % 1000 === 0) {
            log(`Processed ${totalInserted}`);
        }
    } catch (err) {
        console.error(`Insert failed at ${totalInserted} rows:`, err.message);
        throw err;
    }
}

await main();
await postgres.end();
