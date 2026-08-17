import fs from "fs";
import path from "path";
import { postgres } from "../../postgres/postgres.js";
import { streamQuery } from "../../postgres/streamQuery.js";
import { log } from "../../utils/log.js";
import { readManyRezultatasFs } from "./rezultataiFs.js";

const ROWS_PER_FILE = 100_000;
const LOG_EVERY = 1_000;
// Kiek eilučių sukaupiam prieš imant sidecar'us — sutampa su SIDECAR_BATCH_LIMIT.
const LANGAS = 500;


async function run(outputDir) {
    if (!fs.existsSync(outputDir)) {
        const parent = path.dirname(outputDir);
        if (!fs.existsSync(parent)) {
            log(`Klaida: tėvinis aplankas neegzistuoja: ${parent}`);
            process.exit(1);
        }
        fs.mkdirSync(outputDir);
    }

    let totalRows = 0;
    let fileIndex = 0;
    let rowsInFile = 0;
    let fileStream = null;
    const startTime = Date.now();
    let lastLogAt = 0;

    function openNextFile() {
        if (fileStream) fileStream.end();
        const filePath = path.join(outputDir, `filesOcrStatus_${String(fileIndex).padStart(4, "0")}.jsonl`);
        fileStream = fs.createWriteStream(filePath, { encoding: "utf8" });
        fileIndex++;
        rowsInFile = 0;
        log(`Atidaromas failas: ${filePath}`);
    }

    openNextFile();

    // Rezultatų istorijos nebėra — eksportuojamas paskutinis kiekvieno failo
    // rezultatas iš filesOcrStatus. `md5` čia yra resultHash (raktas į FS),
    // o puslapių/žodžių skaičiai — iš po OCR atlikto nuskaitymo.
    const stream = await streamQuery(
        `SELECT o.id AS failas,
                    o."resultHash" AS md5,
                    n.pavadinimas AS node,
                    o."lockTimestamp",
                    o."ocrTimestamp" AS "submitTimestamp",
                    o.duration,
                    o."resultsCount",
                    d."pageCount" AS "puslapiuSkaicius",
                    d."wordCount" AS "zodziuSkaicius"
             FROM public."filesOcrStatus" o
             LEFT JOIN public."ocrNuskaitytojai" n ON n.id = o."nodeId"
             LEFT JOIN public."filesDataExtraction" d ON d.id = o.id
             WHERE o."resultHash" IS NOT NULL
             ORDER BY o.id ASC`,
    );

    /** Vienas langas: sidecar'ai paimami viena užklausa, tada rašom eilutes. */
    function rasytiLanga(langas, sidecarai) {
        for (const row of langas) {
            if (rowsInFile >= ROWS_PER_FILE) openNextFile();
            const rezultatas = sidecarai.get(row.md5);
            fileStream.write(JSON.stringify({ ...row, tekstas: rezultatas?.tekstas ?? null }) + "\n");
            rowsInFile++;
            totalRows++;
            if (totalRows - lastLogAt >= LOG_EVERY) {
                const elapsed = (Date.now() - startTime) / 1000;
                const speed = Math.round(totalRows / elapsed);
                log(`Eksportuota ${totalRows.toLocaleString()} eilučių | greitis: ${speed.toLocaleString()} eil/s | paskutinis failas: ${row.failas}`);
                lastLogAt = totalRows;
            }
        }
    }

    // Jungtį ir transakciją uždaro pats streamQuery – nei `try/finally`, nei
    // `release()` čia nebereikia.
    //
    // Srautą kaupiam į langus, nes sekvenciniam `for await` skaitymo grupavimas
    // nepadeda: per tick'ą ateina po vieną raktą. Su langu vienas `readMany`
    // pakeičia LANGAS skaitymų, o eilučių tvarka išlieka.
    let langas = [];
    for await (const row of stream) {
        langas.push(row);
        if (langas.length < LANGAS) continue;
        rasytiLanga(langas, await readManyRezultatasFs(langas.map((r) => r.md5)));
        langas = [];
    }
    if (langas.length) {
        rasytiLanga(langas, await readManyRezultatasFs(langas.map((r) => r.md5)));
    }

    if (fileStream) fileStream.end();

    const elapsed = (Date.now() - startTime) / 1000;
    const speed = Math.round(totalRows / elapsed);
    log(`Baigta. Iš viso: ${totalRows.toLocaleString()} eilučių per ${elapsed.toFixed(1)}s (${speed.toLocaleString()} eil/s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const outputDir = process.argv[2];
    if (!outputDir) {
        log("Naudojimas: node modules/ocr/eksportuotiRezultatus.js <kelias/į/aplanką>");
        process.exit(1);
    }

    run(outputDir)
        .then(async () => {
            await postgres.end();
            process.exit(0);
        })
        .catch(async (err) => {
            console.error("Klaida:", err);
            await postgres.end();
            process.exit(1);
        });
}
