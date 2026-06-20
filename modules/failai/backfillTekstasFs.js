import fs from "fs";
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { getTekstasPath, hashTekstas, saveTekstasFs } from "./tekstasFs.js";

const BATCH_SIZE = 1_000;
const FS_CONCURRENCY = 32;

async function readFile(filePath) {
    try {
        return await fs.promises.readFile(filePath, "utf8");
    } catch {
        return null;
    }
}

async function processBatch(rows) {
    let written = 0;
    let okExisting = 0;
    let mismatched = 0;
    let skipped = 0;

    let cursor = 0;
    async function worker() {
        while (cursor < rows.length) {
            const row = rows[cursor++];
            if (row.tekstas == null) {
                skipped++;
                continue;
            }
            const hash = hashTekstas(row.tekstas);
            const filePath = getTekstasPath(hash);
            if (!filePath) {
                throw new Error("failaiTekstasLocation nenustatytas arba yra nuotolinis URL");
            }
            const existing = await readFile(filePath);
            if (existing === null) {
                await saveTekstasFs(hash, row.tekstas);
                written++;
            } else if (existing !== row.tekstas) {
                logger.log(`MISMATCH id=${row.id} hash=${hash} — perrašoma`);
                await saveTekstasFs(hash, row.tekstas);
                mismatched++;
            } else {
                okExisting++;
            }
        }
    }

    const workers = Array.from({ length: Math.min(FS_CONCURRENCY, rows.length) }, worker);
    await Promise.all(workers);

    return { written, okExisting, mismatched, skipped };
}

async function run() {
    const startTime = Date.now();
    let lastId = 0;
    let batchNum = 0;
    let totalSeen = 0;
    let totalWritten = 0;
    let totalOk = 0;
    let totalMismatched = 0;
    let totalSkipped = 0;

    while (true) {
        const batchStart = Date.now();
        const { rows } = await postgres.query(
            `SELECT id, tekstas
             FROM public."failaiTekstas"
             WHERE id > $1
             ORDER BY id
             LIMIT $2`,
            [lastId, BATCH_SIZE],
        );

        if (rows.length === 0) break;

        const { written, okExisting, mismatched, skipped } = await processBatch(rows);

        lastId = rows[rows.length - 1].id;
        batchNum++;
        totalSeen += rows.length;
        totalWritten += written;
        totalOk += okExisting;
        totalMismatched += mismatched;
        totalSkipped += skipped;

        const batchMs = Date.now() - batchStart;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round(totalSeen / elapsed);
        logger.log(
            `Batch ${batchNum} | iki id=${lastId} | rašyta: ${written} | sutapo: ${okExisting} | mismatch: ${mismatched} | praleista: ${skipped} | viso: ${totalSeen.toLocaleString()} | greitis: ${speed.toLocaleString()} eil/s | batch: ${batchMs}ms`,
        );

        if (rows.length < BATCH_SIZE) break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.log(
        `Baigta. Peržiūrėta: ${totalSeen.toLocaleString()} | rašyta į FS: ${totalWritten.toLocaleString()} | sutapo: ${totalOk.toLocaleString()} | mismatch: ${totalMismatched.toLocaleString()} | praleista: ${totalSkipped.toLocaleString()} per ${elapsed}s`,
    );
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run()
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
