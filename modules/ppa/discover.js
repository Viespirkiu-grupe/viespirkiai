#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { searchAll } from "../../quickwit/quickwit.js";

const LENTELE = "documents"; // Quickwit indekso vardas, ne DB lentelė
const PPA_TIPAS = "PPA";
const BATCH_SIZE = 1_000;
const SEARCH_QUERY = '(extension:"xlsx") AND "VII.3 PASIULYMU VERTINIMAS"';

const HELP = `Pagal dokumento turinio frazę suranda PPA XLSX failus Quickwit indekse
ir pasirinktinai pažymi juos filesSpecialTypes lentelėje.

Naudojimas:
  node modules/ppa/discover.js [parinktys]

Parinktys:
  --dry-run           Surasti kandidatus, bet nekeisti DB.
  --help, -h          Parodyti šią pagalbą.

Quickwit rezultatai apdorojami ir iškart įrašomi porcijomis po ${BATCH_SIZE}.
Jau pažymėtų failų statusai neperrašomi.`;

export function parseArgs(argv) {
    const options = {
        dryRun: false,
        help: false,
    };

    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === "--dry-run") options.dryRun = true;
        else if (argument === "--help" || argument === "-h") options.help = true;
        else throw new Error(`Nežinoma parinktis: ${argument}`);
    }

    return options;
}

export function buildCursorQuery(afterId) {
    if (afterId == null) return SEARCH_QUERY;
    if (!Number.isSafeInteger(afterId) || afterId < 0) {
        throw new Error("Quickwit cursor turi būti neneigiamas saugus sveikasis skaičius.");
    }
    return `(${SEARCH_QUERY}) AND id:{${afterId} TO *]`;
}

async function loadFileIds(documentIds) {
    if (!documentIds.length) return [];
    const { rows } = await postgres.query(
        `SELECT id, "fileId" AS "failasId"
         FROM documents."documentsFull"
         WHERE id = ANY($1::int[])
           AND extension = 'xlsx'
           AND "fileId" IS NOT NULL`,
        [documentIds],
    );
    return rows.map((row) => Number(row.failasId)).filter(Number.isSafeInteger);
}

async function insertPpaIds(fileIds) {
    if (!fileIds.length) return 0;
    const { rowCount } = await postgres.query(
        `WITH tipas AS (
             INSERT INTO public."filesSpecialTypeNames" (type)
             VALUES ($1)
             ON CONFLICT (type) DO UPDATE SET type = EXCLUDED.type
             RETURNING id
         )
         INSERT INTO public."filesSpecialTypes" (id, "typeId", status)
         SELECT DISTINCT f.id, t.id, NULL::smallint
         FROM unnest($2::int[]) AS f(id)
         CROSS JOIN tipas t
         JOIN public.files pf ON pf.id = f.id
         ON CONFLICT (id, "typeId") DO NOTHING`,
        [PPA_TIPAS, fileIds],
    );
    return rowCount;
}

export async function discoverPpa({
    dryRun = false,
    onProgress = null,
} = {}) {
    let afterId = null;
    let batches = 0;
    let quickwitHits = 0;
    let mappedFiles = 0;
    let inserted = 0;

    while (true) {
        const result = await searchAll(
            LENTELE,
            { query: buildCursorQuery(afterId), sort_by: "-id" },
            { pageSize: BATCH_SIZE, limit: BATCH_SIZE, maxPages: 1 },
        );
        batches++;
        quickwitHits += result.hits.length;

        const documentIds = result.hits
            .map((hit) => Number(hit.id))
            .filter(Number.isSafeInteger);
        const fileIds = await loadFileIds(documentIds);
        mappedFiles += fileIds.length;
        if (!dryRun) inserted += await insertPpaIds(fileIds);

        const rawCursor = Number(result.lastRawHit?.id);
        onProgress?.({
            afterId: rawCursor,
            batch: batches,
            batchHits: result.hits.length,
            batchFiles: fileIds.length,
            inserted,
        });

        if (
            result.rawExhausted
            || !Number.isSafeInteger(rawCursor)
            || rawCursor === afterId
        ) break;
        afterId = rawCursor;
    }

    return {
        batches,
        dryRun,
        inserted,
        mappedFiles,
        quickwitHits,
    };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
        console.log(HELP);
        return;
    }

    console.log(`Quickwit užklausa: ${SEARCH_QUERY}`);
    console.log(options.dryRun ? "Režimas: peržiūra (DB nekeičiama)" : "Režimas: įrašymas");
    const result = await discoverPpa({
        ...options,
        onProgress: ({ batch, batchHits, batchFiles, inserted, afterId }) => {
            const writeInfo = options.dryRun ? "" : `, iš viso įrašyta ${inserted}`;
            console.log(`Porcija ${batch}: ${batchHits} rezultatų, ${batchFiles} failų${writeInfo}, cursor=${afterId}`);
        },
    });

    console.log("");
    console.log(`Quickwit rezultatų: ${result.quickwitHits}`);
    console.log(`Su failais susietų rezultatų: ${result.mappedFiles}`);
    if (!options.dryRun) console.log(`Naujai pažymėta: ${result.inserted}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        await main();
    } catch (error) {
        console.error(error?.stack ?? error);
        process.exitCode = 1;
    } finally {
        await postgres.end();
    }
}
