import fs from "fs";
import path from "path";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { readMetaduomenysFs } from "./metaduomenysFs.js";

const BATCH_SIZE = 1_000;
const ROWS_PER_FILE = 100_000;


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

    function openNextFile() {
        if (fileStream) fileStream.end();
        const filePath = path.join(outputDir, `failaiMetaduomenys_${String(fileIndex).padStart(4, "0")}.jsonl`);
        fileStream = fs.createWriteStream(filePath, { encoding: "utf8" });
        fileIndex++;
        rowsInFile = 0;
        log(`Atidaromas failas: ${filePath}`);
    }

    openNextFile();

    let cursor = 0;
    while (true) {
        const { rows } = await postgres.query(
            `SELECT id, "metaduomenysHash"
             FROM public.failai
             WHERE id > $1
             ORDER BY id ASC
             LIMIT $2`,
            [cursor, BATCH_SIZE],
        );
        if (rows.length === 0) break;
        cursor = rows[rows.length - 1].id;

        const withHash = rows.filter((r) => r.metaduomenysHash);
        const metaduomenysList = await Promise.all(
            withHash.map((r) => readMetaduomenysFs(r.metaduomenysHash)),
        );

        for (let i = 0; i < withHash.length; i++) {
            if (rowsInFile >= ROWS_PER_FILE) openNextFile();
            const r = withHash[i];
            fileStream.write(
                JSON.stringify({ id: r.id, metaduomenysHash: r.metaduomenysHash, metaduomenys: metaduomenysList[i] }) + "\n",
            );
            rowsInFile++;
            totalRows++;
        }

        const elapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round(totalRows / elapsed);
        log(`Eksportuota ${totalRows.toLocaleString()} eilučių | greitis: ${speed.toLocaleString()} eil/s | paskutinis id: ${cursor}`);

        if (rows.length < BATCH_SIZE) break;
    }

    if (fileStream) fileStream.end();

    const elapsed = (Date.now() - startTime) / 1000;
    const speed = Math.round(totalRows / elapsed);
    log(`Baigta. Iš viso: ${totalRows.toLocaleString()} eilučių per ${elapsed.toFixed(1)}s (${speed.toLocaleString()} eil/s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const outputDir = process.argv[2];
    if (!outputDir) {
        log("Naudojimas: node modules/failai/eksportuotiMetaduomenis.js <kelias/į/aplanką>");
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
