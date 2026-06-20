import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { fetchFailaiSlice, upsertBatch } from "./upsertFromFailai.js";

const BATCH_SIZE = 1_000;

async function run() {
    const startTime = Date.now();
    const refresh = process.argv.includes("--refresh");
    const fromIdx = process.argv.indexOf("--from");
    const fromId = fromIdx >= 0 ? Number(process.argv[fromIdx + 1]) : null;

    let lastId;
    if (fromId != null && Number.isFinite(fromId)) {
        lastId = fromId;
        logger.log(`--from ${fromId}: pradedame nuo failai.id > ${fromId} (ON CONFLICT atnaujins esamus)`);
    } else if (refresh) {
        lastId = 0;
        logger.log(`--refresh: pradedame nuo failai.id > 0, jau esantys įrašai bus atnaujinti per ON CONFLICT`);
    } else {
        const {
            rows: [{ max }],
        } = await postgres.query(
            `SELECT COALESCE(MAX("failasId"), 0) AS max
             FROM public.dokumentai WHERE "failasId" IS NOT NULL`,
        );
        lastId = Number(max);
        logger.log(`Pradedame nuo failai.id > ${lastId} (--refresh peržiūrėti visus, --from <id> nuo konkretaus)`);
    }

    let batchNum = 0;
    let totalInserted = 0;
    let totalSkipped = 0;

    async function fetchBatch(afterId) {
        const t0 = Date.now();
        const rows = await fetchFailaiSlice(afterId, BATCH_SIZE);
        return { rows, selectMs: Date.now() - t0 };
    }

    // Pipeline: keep one batch fetch in flight while we process the current batch.
    let nextFetch = fetchBatch(lastId);

    while (true) {
        const batchStart = Date.now();
        const { rows, selectMs } = await nextFetch;
        if (rows.length === 0) break;

        lastId = rows[rows.length - 1].id;
        nextFetch = rows.length === BATCH_SIZE
            ? fetchBatch(lastId)
            : Promise.resolve({ rows: [], selectMs: 0 });

        const { inserted, skipped, fsMs, insertMs } = await upsertBatch(rows);

        batchNum++;
        totalInserted += inserted;
        totalSkipped += skipped;

        const batchMs = Date.now() - batchStart;
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round(totalInserted / elapsed);
        logger.log(
            `Batch ${batchNum} | iki id=${lastId} | sukurta: ${inserted} | praleista: ${skipped} | viso: ${totalInserted.toLocaleString()} | ${speed.toLocaleString()} eil/s | batch ${batchMs}ms (select ${selectMs}ms, fs ${fsMs}ms, insert ${insertMs}ms)`,
        );
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.log(
        `Baigta. Sukurta dokumentai: ${totalInserted.toLocaleString()} | praleista: ${totalSkipped.toLocaleString()} per ${elapsed}s`,
    );
    logger.log(`Pastaba: 'parent' nuoroda dar neišspręsta — paleisti pass 2 atskirai.`);
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
