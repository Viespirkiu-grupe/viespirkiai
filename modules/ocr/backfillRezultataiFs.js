import { postgres, parsePgArray } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { saveRezultatasFs, getRezultatasPath } from "./rezultataiFs.js";
import fs from "fs";

const BATCH_SIZE = 1_000;

async function run() {
    let lastId = 0;
    let totalWritten = 0;
    let batchNum = 0;
    const startTime = Date.now();

    while (true) {
        const { rows } = await postgres.query(
            `SELECT id, failas, md5, tekstas, node, "submitTimestamp", "lockTimestamp", duration, "puslapiuSkaicius", "zodziuSkaicius"
             FROM public."failaiOcrRezultatai"
             WHERE id > $1
             ORDER BY id ASC
             LIMIT $2`,
            [lastId, BATCH_SIZE],
        );

        if (rows.length === 0) break;

        const batchStart = Date.now();

        let batchWritten = 0;
        await Promise.all(rows.map(async (row) => {
            if (!row.md5) return;
            if (fs.existsSync(getRezultatasPath(row.md5))) return;
            await saveRezultatasFs({
                failas: row.failas,
                md5: row.md5,
                tekstas: row.tekstas != null ? parsePgArray(row.tekstas) : null,
                node: row.node,
                submitTimestamp: row.submitTimestamp,
                lockTimestamp: row.lockTimestamp,
                duration: row.duration,
                puslapiuSkaicius: row.puslapiuSkaicius,
                zodziuSkaicius: row.zodziuSkaicius,
            });
            totalWritten++;
            batchWritten++;
        }));

        lastId = rows[rows.length - 1].id;
        batchNum++;
        const batchMs = Date.now() - batchStart;
        const totalElapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round((batchNum * BATCH_SIZE) / totalElapsed);

        log(`Batch ${batchNum} | parašyta: ${batchWritten} | iš viso parašyta: ${totalWritten.toLocaleString()} | paskutinis id: ${lastId} | greitis: ${speed.toLocaleString()} eil/s | batch: ${batchMs}ms`);

        if (rows.length < BATCH_SIZE) break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Baigta. Iš viso parašyta: ${totalWritten.toLocaleString()} per ${elapsed}s`);
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
