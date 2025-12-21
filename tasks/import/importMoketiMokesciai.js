#!/usr/bin/env node
/*
Importuoja mokėtų mokesčių duomenis tiesiai iš data.gov.lt API į Postgres
https://data.gov.lt/datasets/673/
*/
import { postgres } from "../../postgres/postgres.js";

const BASE = "https://get.data.gov.lt/datasets/gov/vmi/ja_mokesciai/Moketojas";
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

let totalProcessed = 0;
let pageNr = 1;

async function main() {
    let nextPage = null;

    while (true) {
        const data = await fetchPage(nextPage);

        if (!data._data || data._data.length === 0) {
            console.log("Baigta. Daugiau duomenų nėra.");
            break;
        }

        console.log(`→ Page ${pageNr}: ${data._data.length} įrašų`);

        let batch = [];

        for (const obj of data._data) {
            batch.push([
                obj._id ?? null, // _id
                obj.id ?? null, // id
                obj.mm_kodas?._id ?? null, // mm_kodas_id
                obj.id ?? null, // jarKodas (VMI naudoja tą patį)
                obj.pavadinimas ?? null, // pavadinimas
                obj.tipas ?? null, // formosPavadinimas
                obj.apskritis?._id ?? null, // apskritis
                obj.savivaldybe?._id ?? null, // savivaldybe
                obj.metai ?? null, // metai
                obj.menuo ?? null, // menuo
                obj.suma ?? null, // suma
                obj.atnaujinta ?? null, // duomenuData
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

    console.log("DONE. Iš viso apdorota:", totalProcessed);
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
        INSERT INTO mokesciai (
            "_id", id, "mm_kodas_id", "jarKodas", pavadinimas,
            "formosPavadinimas", apskritis, savivaldybe,
            metai, menuo, suma, "duomenuData"
        )
        VALUES ${placeholders}
        ON CONFLICT ("_id") DO UPDATE SET
            id = EXCLUDED.id,
            "mm_kodas_id" = EXCLUDED."mm_kodas_id",
            "jarKodas" = EXCLUDED."jarKodas",
            pavadinimas = EXCLUDED.pavadinimas,
            "formosPavadinimas" = EXCLUDED."formosPavadinimas",
            apskritis = EXCLUDED.apskritis,
            savivaldybe = EXCLUDED.savivaldybe,
            metai = EXCLUDED.metai,
            menuo = EXCLUDED.menuo,
            suma = EXCLUDED.suma,
            "duomenuData" = EXCLUDED."duomenuData"
    `;

    try {
        await postgres.query(sql, rows.flat());
        totalProcessed += rows.length;

        if (totalProcessed % 1000 === 0) {
            console.log(`✓ Processed ${totalProcessed}`);
        }
    } catch (err) {
        console.error(`Insert failed at ${totalProcessed} rows:`, err.message);
        throw err;
    }
}

await main();
await postgres.end();
