#!/usr/bin/env node
/*
Importuoja BalansoAtaskaitas tiesiai iš data.gov.lt API į Postgres su puslapiavimu
https://data.gov.lt/datasets/1806/
*/
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

const BASE =
    "https://get.data.gov.lt/datasets/gov/rc/jar/balanso_ataskaitos/BalansoAtaskaita";
const LIMIT = 10_000;
const BATCH_SIZE = 100;

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
            logger.log("Baigta. Daugiau duomenų nėra.");
            break;
        }

        logger.log(`→ Page ${pageNr}: ${data._data.length} įrašų`);

        let batch = [];

        for (const obj of data._data) {
            batch.push([
                obj._id ?? null, // _id
                obj.juridinis_asmuo?._id ?? null, // jarId
                obj.forma?._id ?? null, // formaId
                obj.statusas?._id ?? null, // statusasId
                obj.template_id ?? null, // templateId
                obj.template_name ?? null, // templateName
                obj.standard_id ?? null, // standardId
                obj.standard_name ?? null, // standardName
                obj.line_type_id ?? null, // lineTypeId
                obj.line_name ?? null, // lineName
                obj.reiksme ?? null, // reiksme
                obj.laikotarpis_nuo ?? null, // laikotarpisNuo
                obj.laikotarpis_iki ?? null, // laikotarpisIki
                obj.reg_date ?? null, // duomenuData
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
        INSERT INTO "balansoAtaskaitos" (
            "_id", "jarId", "formaId", "statusasId", "templateId", "templateName",
            "standardId", "standardName", "lineTypeId", "lineName", "reiksme",
            "laikotarpisNuo", "laikotarpisIki", "duomenuData"
        )
        VALUES ${placeholders}
        ON CONFLICT (
            "jarId", "lineName",
            "laikotarpisNuo", "laikotarpisIki", "duomenuData"
        ) DO NOTHING
    `;

    try {
        await postgres.query(sql, rows.flat());
        totalInserted += rows.length;

        if (totalInserted % 1000 === 0) {
            logger.log(`Inserted ${totalInserted}`);
        }
    } catch (err) {
        console.error(`Insert failed at ${totalInserted} rows:`, err.message);
        throw err;
    }
}

await main();
await postgres.end();
