#!/usr/bin/env node
/*
Importuoja PelnoAtaskaitos duomenis tiesiai iš data.gov.lt API į PostgreSQL
https://data.gov.lt/datasets/1666/
*/
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("finansai", { operation: "importPelnoNuostoliuAtaskaitos" });
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import config from "../../utils/config.js";
const logger = new Logger();

const BASE = `${config.dataGovUrl}/datasets/gov/rc/jar/pelno_ataskaitos/PelnoAtaskaita`;
const LIMIT = 10_000;
const BATCH_SIZE = 200;

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

    logger.log("DONE. Iš viso apdorota:", totalProcessed);
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
        WITH input (
            "_id", "jarId", "formaId", "statusasId", "templateId", "templateName",
            "standardId", "standardName", "lineTypeId", "lineName", "reiksme",
            "laikotarpisNuo", "laikotarpisIki", "duomenuData"
        ) AS (
            VALUES ${placeholders}
        ),
        templates AS (
            INSERT INTO "adpFinansinesAtaskaitos"."pelnoNuostoliuFormos" ("templateId", "templateName")
            SELECT DISTINCT "templateId", "templateName"
            FROM input
            WHERE "templateId" IS NOT NULL
            ON CONFLICT ("templateId") DO UPDATE
            SET "templateName" = EXCLUDED."templateName"
            WHERE "adpFinansinesAtaskaitos"."pelnoNuostoliuFormos".templateName" IS DISTINCT FROM EXCLUDED."templateName"
        ),
        standards AS (
            INSERT INTO "adpFinansinesAtaskaitos"."pelnoNuostoliuStandartai" ("standardId", "standardName")
            SELECT DISTINCT "standardId", "standardName"
            FROM input
            WHERE "standardId" IS NOT NULL
            ON CONFLICT ("standardId") DO UPDATE
            SET "standardName" = EXCLUDED."standardName"
            WHERE "adpFinansinesAtaskaitos"."pelnoNuostoliuStandartai".standardName" IS DISTINCT FROM EXCLUDED."standardName"
        ),
        lines AS (
            INSERT INTO "adpFinansinesAtaskaitos"."pelnoNuostoliuEiluciuTipai" ("lineTypeId", "lineName")
            SELECT DISTINCT "lineTypeId", "lineName"
            FROM input
            WHERE "lineTypeId" IS NOT NULL
            ON CONFLICT ("lineTypeId") DO UPDATE
            SET "lineName" = EXCLUDED."lineName"
            WHERE "adpFinansinesAtaskaitos"."pelnoNuostoliuEiluciuTipai".lineName" IS DISTINCT FROM EXCLUDED."lineName"
        )
        INSERT INTO "adpFinansinesAtaskaitos"."pelnoNuostoliuEilutes" (
            "_id", "jarId", "formaId", "statusasId", "templateId", "standardId", "lineTypeId",
            "reiksme", "laikotarpisNuo", "laikotarpisIki", "duomenuData"
        )
        SELECT input."_id", input."jarId", input."formaId", input."statusasId",
               input."templateId", input."standardId", input."lineTypeId",
               input."reiksme", input."laikotarpisNuo", input."laikotarpisIki", input."duomenuData"
        FROM input
        ON CONFLICT (
            "jarId", "lineTypeId",
            "laikotarpisNuo", "laikotarpisIki", "duomenuData"
        ) DO NOTHING
    `;

    try {
        await postgres.query(sql, rows.flat());
        totalProcessed += rows.length;
        if (totalProcessed % 1000 === 0) {
            logger.log(`Importuota ${totalProcessed} įrašų`);
        }
    } catch (err) {
        console.error(
            `Įterpimas nepavyko po ${totalProcessed} įrašų:`,
            err.message,
        );
        throw err;
    }
}

await main();
await postgres.end();
