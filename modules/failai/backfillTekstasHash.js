import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { getTekstasPath, hashTekstas, saveTekstasFs } from "./tekstasFs.js";
import fs from "fs";

const BATCH_SIZE = 1_000;
const FS_CONCURRENCY = 32;

async function fileExists(filePath) {
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function processBatch(rows) {
    // Decide per row: skipped, file-written, hash-updated.
    const updates = []; // [{ id, hash }]
    let written = 0;
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
            if (!(await fileExists(filePath))) {
                await saveTekstasFs(hash, row.tekstas);
                written++;
            }
            if (row.tekstasHash !== hash) {
                updates.push({ id: row.id, hash });
            }
        }
    }

    const workers = Array.from({ length: Math.min(FS_CONCURRENCY, rows.length) }, worker);
    await Promise.all(workers);

    if (updates.length > 0) {
        const ids = updates.map((u) => u.id);
        const hashes = updates.map((u) => u.hash);
        await postgres.query(
            `UPDATE public.failai f
             SET "tekstasHash" = v.hash
             FROM (SELECT UNNEST($1::bigint[]) AS id, UNNEST($2::text[]) AS hash) v
             WHERE f.id = v.id
               AND f."tekstasHash" IS DISTINCT FROM v.hash`,
            [ids, hashes],
        );
    }

    return { written, skipped, updated: updates.length };
}

async function run() {
    const startTime = Date.now();
    let lastId = 0;
    let batchNum = 0;
    let totalSeen = 0;
    let totalWritten = 0;
    let totalUpdated = 0;
    let totalSkipped = 0;

    while (true) {
        const batchStart = Date.now();
        const { rows } = await postgres.query(
            `SELECT f.id, f."tekstasHash", t.tekstas
             FROM public.failai f
             LEFT JOIN public."failaiTekstas" t ON t.id = f.id
             WHERE f.id > $1
             ORDER BY f.id
             LIMIT $2`,
            [lastId, BATCH_SIZE],
        );

        if (rows.length === 0) break;

        const { written, skipped, updated } = await processBatch(rows);

        lastId = rows[rows.length - 1].id;
        batchNum++;
        totalSeen += rows.length;
        totalWritten += written;
        totalUpdated += updated;
        totalSkipped += skipped;

        const batchMs = Date.now() - batchStart;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round(totalSeen / elapsed);
        logger.log(
            `Batch ${batchNum} | iki id=${lastId} | rašyta: ${written} | atnaujinta: ${updated} | praleista: ${skipped} | viso: ${totalSeen.toLocaleString()} | greitis: ${speed.toLocaleString()} eil/s | batch: ${batchMs}ms`,
        );

        if (rows.length < BATCH_SIZE) break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.log(
        `Baigta. Peržiūrėta: ${totalSeen.toLocaleString()} | rašyta į FS: ${totalWritten.toLocaleString()} | atnaujinta DB: ${totalUpdated.toLocaleString()} | praleista: ${totalSkipped.toLocaleString()} per ${elapsed}s`,
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
