#!/usr/bin/env node
/*
Importuoja JAR duomenis tiesiai iš data.gov.lt API į PostgreSQL su puslapiavimu
https://get.data.gov.lt/datasets/gov/rc/jar/iregistruoti/JuridinisAsmuo
*/
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("juridiniai", { operation: "importJar" });
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import config from "../../utils/config.js";

const BASE = `${config.dataGovUrl}/datasets/gov/rc/jar/iregistruoti/JuridinisAsmuo`;
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

        log(`Page ${pageNr}: ${data._data.length} įrašų`);

        let batch = [];

        for (const obj of data._data) {
            batch.push([
                obj._id ?? null, // id
                obj.ja_kodas ?? null, // jarKodas
                obj.ja_pavadinimas ?? null, // pavadinimas
                obj.pilnas_adresas ?? null, // adresas
                obj.adresas?._id ?? null, // adresasId
                obj.reg_data ?? null, // registravimoData
                obj.isreg_data ?? null, // isregistravimoData
                obj.forma?._id ?? null, // formaId
                obj.statusas?._id ?? null, // statusasId
                obj.stat_data ?? null, // statusasData
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
        INSERT INTO "jar" (
            "id", "jarKodas", "pavadinimas", "adresas", "adresasId",
            "registravimoData", "isregistravimoData",
            "formaId", "statusasId", "statusasData"
        )
        VALUES ${placeholders}
        ON CONFLICT ("jarKodas") DO NOTHING
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
