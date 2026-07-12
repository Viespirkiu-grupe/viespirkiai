import fs from "fs";
import path from "path";
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { readMetaduomenysFs } from "./metaduomenysFs.js";
import { readFailaiFs } from "./failaiFs.js";

const BATCH_SIZE = 1_000;
const ROWS_PER_FILE = 100_000;


async function run(outputDir) {
    if (!fs.existsSync(outputDir)) {
        const parent = path.dirname(outputDir);
        if (!fs.existsSync(parent)) {
            logger.log(`Klaida: tėvinis aplankas neegzistuoja: ${parent}`);
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
        logger.log(`Atidaromas failas: ${filePath}`);
    }

    openNextFile();

    let cursor = 0;
    while (true) {
        const { rows } = await postgres.query(
            `SELECT f.id, i."failasHash", f."metaduomenysHash"
             FROM public.failai f
             LEFT JOIN public."failaiInfoFailai" i ON i.id = f.id
             WHERE f.id > $1
             ORDER BY f.id ASC
             LIMIT $2`,
            [cursor, BATCH_SIZE],
        );
        if (rows.length === 0) break;
        cursor = rows[rows.length - 1].id;

        const withHash = rows.filter((r) => r.failasHash || r.metaduomenysHash);
        const metaduomenysList = await Promise.all(
            // Naujas kelias — metaduomenys iš sujungto FS failo; pereinamasis — senas failas.
            withHash.map((r) =>
                r.failasHash
                    ? readFailaiFs(r.failasHash).then((t) => t?.metaduomenys ?? null)
                    : readMetaduomenysFs(r.metaduomenysHash),
            ),
        );

        for (let i = 0; i < withHash.length; i++) {
            if (rowsInFile >= ROWS_PER_FILE) openNextFile();
            const r = withHash[i];
            fileStream.write(
                JSON.stringify({ id: r.id, failasHash: r.failasHash, metaduomenysHash: r.metaduomenysHash, metaduomenys: metaduomenysList[i] }) + "\n",
            );
            rowsInFile++;
            totalRows++;
        }

        const elapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round(totalRows / elapsed);
        logger.log(`Eksportuota ${totalRows.toLocaleString()} eilučių | greitis: ${speed.toLocaleString()} eil/s | paskutinis id: ${cursor}`);

        if (rows.length < BATCH_SIZE) break;
    }

    if (fileStream) fileStream.end();

    const elapsed = (Date.now() - startTime) / 1000;
    const speed = Math.round(totalRows / elapsed);
    logger.log(`Baigta. Iš viso: ${totalRows.toLocaleString()} eilučių per ${elapsed.toFixed(1)}s (${speed.toLocaleString()} eil/s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const outputDir = process.argv[2];
    if (!outputDir) {
        logger.log("Naudojimas: node modules/failai/eksportuotiMetaduomenis.js <kelias/į/aplanką>");
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
