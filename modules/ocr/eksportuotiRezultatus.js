import fs from "fs";
import path from "path";
import QueryStream from "pg-query-stream";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { readRezultatasFs } from "./rezultataiFs.js";

const ROWS_PER_FILE = 100_000;
const LOG_EVERY = 1_000;


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
        const filePath = path.join(outputDir, `failaiOcrRezultatai_${String(fileIndex).padStart(4, "0")}.jsonl`);
        fileStream = fs.createWriteStream(filePath, { encoding: "utf8" });
        fileIndex++;
        rowsInFile = 0;
        log(`Atidaromas failas: ${filePath}`);
    }

    openNextFile();

    const client = await postgres.connect();
    try {
        const qs = new QueryStream(
            `SELECT id, failas, md5, node, "lockTimestamp", "submitTimestamp", duration, "puslapiuSkaicius", "zodziuSkaicius"
             FROM public."failaiOcrRezultatai"
             ORDER BY id ASC`,
        );
        const stream = client.query(qs);

        for await (const row of stream) {
            if (rowsInFile >= ROWS_PER_FILE) openNextFile();
            const rezultatas = await readRezultatasFs(row.md5);
            fileStream.write(JSON.stringify({ ...row, tekstas: rezultatas?.tekstas ?? null }) + "\n");
            rowsInFile++;
            totalRows++;
            if (totalRows - lastLogAt >= LOG_EVERY) {
                const elapsed = (Date.now() - startTime) / 1000;
                const speed = Math.round(totalRows / elapsed);
                log(`Eksportuota ${totalRows.toLocaleString()} eilučių | greitis: ${speed.toLocaleString()} eil/s | paskutinis id: ${row.id}`);
                lastLogAt = totalRows;
            }
        }
    } finally {
        client.release();
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
