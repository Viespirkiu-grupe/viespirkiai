import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const BATCH_SIZE = 1_000;

async function run() {
    let totalUpdated = 0;
    let batchNum = 0;
    const startTime = Date.now();

    while (true) {
        const batchStart = Date.now();

        const { rowCount } = await postgres.query(
            `UPDATE public."failaiOcrRezultatai" r
             SET md5 = sub.md5
             FROM (
                 SELECT r2.id, f.md5
                 FROM public."failaiOcrRezultatai" r2
                 JOIN public.failai f ON f.id = r2.failas
                 WHERE r2.md5 IS NULL
                 LIMIT $1
             ) sub
             WHERE r.id = sub.id`,
            [BATCH_SIZE],
        );

        if (rowCount === 0) break;

        totalUpdated += rowCount;
        batchNum++;
        const batchMs = Date.now() - batchStart;
        const totalElapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round(totalUpdated / totalElapsed);

        log(`Batch ${batchNum} | atnaujinta: ${rowCount} | iš viso: ${totalUpdated.toLocaleString()} | greitis: ${speed.toLocaleString()} eil/s | batch: ${batchMs}ms`);

        if (rowCount < BATCH_SIZE) break;
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Baigta. Iš viso atnaujinta: ${totalUpdated.toLocaleString()} per ${elapsed}s`);
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
