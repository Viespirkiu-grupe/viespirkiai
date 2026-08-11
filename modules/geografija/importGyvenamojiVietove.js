#!/usr/bin/env node
/*
Importuoja gyvenamąsias vietoves iš data.gov.lt API į Postgres
https://data.gov.lt/datasets/1287/
*/
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("geografija", { operation: "importGyvenamojiVietove" });
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import config from "../../utils/config.js";
const logger = new Logger();

const BASE = `${config.dataGovUrl}/datasets/gov/rc/ar/gyvenamojivietove/GyvenamojiVietove`;
const LIMIT = 10_000;
const BATCH_SIZE = 500;

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
            logger.log("Baigta. Daugiau duomenų nėra.");
            break;
        }

        logger.log(`Page ${pageNr}: ${data._data.length} įrašų`);

        let batch = [];

        for (const r of data._data) {
            batch.push([
                r._id ?? null,
                r.gyv_kodas ?? null,
                r.tipas ?? null,
                r.tipo_santrumpa ?? null,
                r.pavadinimas_k ?? null,
                r.pavadinimas ?? null,
                r.seniunija?._id ?? null,
                r.savivaldybe?._id ?? null,
                r.gyv_nuo ?? null,
                r.gyv_iki ?? null,
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

    logger.log("DONE. Iš viso įterpta:", totalInserted);
}

async function insertBatch(rows) {
    if (rows.length === 0) return;

    const placeholders = rows
        .map(
            (_, rowIndex) =>
                `(${Array.from({ length: 10 })
                    .map((_, colIndex) => `$${rowIndex * 10 + colIndex + 1}`)
                    .join(", ")})`,
        )
        .join(", ");

    const sql = `
        INSERT INTO public."gyvenamosVietoves" (
            "_id", "gyvKodas", tipas, "tipoSantrumpa", "pavadinimasK", pavadinimas,
            seniunija, savivaldybe, "gyvNuo", "gyvIki"
        )
        VALUES ${placeholders}
        ON CONFLICT ("gyvKodas") DO NOTHING
    `;

    try {
        await postgres.query(sql, rows.flat());
        totalInserted += rows.length;

        if (totalInserted % 1000 === 0) {
            logger.log(`Įterpta ${totalInserted}`);
        }
    } catch (err) {
        console.error(`Insert failed at ${totalInserted} rows:`, err.message);
        throw err;
    }
}

await main();
await postgres.end();
