#!/usr/bin/env node
/*
Importuoja mokėtų mokesčių duomenis tiesiai iš data.gov.lt API į Postgres
https://data.gov.lt/datasets/673/
*/
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("vmi", { operation: "importMoketiMokesciai" });
import { postgres } from "../../postgres/postgres.js";
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
            batch.push([
                obj._id ?? null, // _id
                obj.id ?? null, // id
                obj.mm_kodas?._id ?? null, // jarId (= public."jar"._id)
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

    log("DONE. Iš viso apdorota:", totalProcessed);
}

async function insertBatch(rows) {
    if (rows.length === 0) return;

    // Žodynų upsert'ai CTE viduje + faktų eilutės vienu sakiniu; „jau buvo" /
    // „ką tik įrašėm" atvejus sutvarko UNION ALL prieš žodyno lentelę.
    const sql = `
        WITH incoming AS (
            SELECT * FROM unnest(
                $1::uuid[], $2::integer[], $3::uuid[], $4::text[],
                $5::text[], $6::uuid[], $7::uuid[], $8::smallint[], $9::smallint[],
                $10::double precision[], $11::date[]
            ) AS x("_id", "id", "jarId", "pavadinimas",
                   "forma", "apskritis", "savivaldybe", "metai", "menuo",
                   "suma", "duomenuData")
        ), ins_pavadinimai AS (
            INSERT INTO "vmi"."pavadinimai" ("pavadinimas")
            SELECT DISTINCT "pavadinimas" FROM incoming WHERE "pavadinimas" IS NOT NULL
            ON CONFLICT ("pavadinimas") DO NOTHING RETURNING "id", "pavadinimas"
        ), ins_formos AS (
            INSERT INTO "vmi"."formos" ("pavadinimas")
            SELECT DISTINCT "forma" FROM incoming WHERE "forma" IS NOT NULL
            ON CONFLICT ("pavadinimas") DO NOTHING RETURNING "id", "pavadinimas"
        ), ins_apskritys AS (
            INSERT INTO "vmi"."apskritys" ("adpId")
            SELECT DISTINCT "apskritis" FROM incoming WHERE "apskritis" IS NOT NULL
            ON CONFLICT ("adpId") DO NOTHING RETURNING "id", "adpId"
        ), ins_savivaldybes AS (
            INSERT INTO "vmi"."savivaldybes" ("adpId")
            SELECT DISTINCT "savivaldybe" FROM incoming WHERE "savivaldybe" IS NOT NULL
            ON CONFLICT ("adpId") DO NOTHING RETURNING "id", "adpId"
        )
        INSERT INTO "vmi"."mokesciai" AS old (
            "_id", "id", "jarId", "pavadinimoId", "formosId",
            "apskritiesId", "savivaldybesId", "metai", "menuo", "suma", "duomenuData"
        )
        SELECT i."_id", i."id", i."jarId",
               (SELECT "id" FROM "vmi"."pavadinimai" WHERE "pavadinimas" = i."pavadinimas"
                 UNION ALL SELECT "id" FROM ins_pavadinimai WHERE "pavadinimas" = i."pavadinimas" LIMIT 1),
               (SELECT "id" FROM "vmi"."formos" WHERE "pavadinimas" = i."forma"
                 UNION ALL SELECT "id" FROM ins_formos WHERE "pavadinimas" = i."forma" LIMIT 1),
               (SELECT "id" FROM "vmi"."apskritys" WHERE "adpId" = i."apskritis"
                 UNION ALL SELECT "id" FROM ins_apskritys WHERE "adpId" = i."apskritis" LIMIT 1),
               (SELECT "id" FROM "vmi"."savivaldybes" WHERE "adpId" = i."savivaldybe"
                 UNION ALL SELECT "id" FROM ins_savivaldybes WHERE "adpId" = i."savivaldybe" LIMIT 1),
               i."metai", i."menuo", i."suma", i."duomenuData"
        FROM incoming i
        ON CONFLICT ("_id") DO UPDATE SET
            "id"             = EXCLUDED."id",
            "jarId"          = EXCLUDED."jarId",
            "pavadinimoId"   = EXCLUDED."pavadinimoId",
            "formosId"       = EXCLUDED."formosId",
            "apskritiesId"   = EXCLUDED."apskritiesId",
            "savivaldybesId" = EXCLUDED."savivaldybesId",
            "metai"          = EXCLUDED."metai",
            "menuo"          = EXCLUDED."menuo",
            "suma"           = EXCLUDED."suma",
            "duomenuData"    = EXCLUDED."duomenuData"
        WHERE ROW(old."jarId", old."metai", old."menuo",
                  old."suma", old."duomenuData")
          IS DISTINCT FROM
              ROW(EXCLUDED."jarId", EXCLUDED."metai",
                  EXCLUDED."menuo", EXCLUDED."suma", EXCLUDED."duomenuData")
    `;

    // unnest() nori stulpelių masyvų, ne eilučių.
    const columns = rows[0].map((_, i) => rows.map((row) => row[i]));

    try {
        await postgres.query(sql, columns);
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
