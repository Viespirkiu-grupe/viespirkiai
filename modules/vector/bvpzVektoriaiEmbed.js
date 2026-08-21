import { performance } from "node:perf_hooks";
import { postgres } from "../../postgres/postgres.js";
import { limitArg, numArg, parseArgs } from "../../utils/cliArgs.js";
import { nf, secs, SlidingEta } from "../../utils/progress.js";
import { runStream } from "../../utils/workerPool.js";
import {
    closeSqlite,
    createBvpzBeVektoriausReader,
    createBvpzVektoriuWriter,
    getBvpzCounts,
    getBvpzVektoriaiSqlitePath,
    openBvpzVektoriaiSqlite,
    prepareModel,
    setMeta,
    syncBvpzRows,
} from "./bvpzVektoriaiSqlite.js";
import { createOllamaEmbedder, DEFAULT_EMBED_MODEL, DEFAULT_OLLAMA_URL, newEmbedStats } from "./ollamaEmbed.js";
import { BGE_M3_DIM, vecToBlob } from "./vektoriai.js";

const args = parseArgs(process.argv.slice(2));
const DB_PATH = typeof args.db === "string" ? args.db : getBvpzVektoriaiSqlitePath();
const URL = typeof args.url === "string" ? args.url : DEFAULT_OLLAMA_URL;
const MODEL = typeof args.model === "string" ? args.model : DEFAULT_EMBED_MODEL;
const CONCURRENCY = numArg(args.concurrency, 4);
const BATCH = numArg(args.batch, 50);
const LIMIT = limitArg(args.limit);
const EXPECTED_DIM = numArg(args.dim, BGE_M3_DIM);

async function main() {
    const db = openBvpzVektoriaiSqlite({ dbPath: DB_PATH });
    try {
        console.log(`═══ ${DB_PATH} ═══`);
        const result = await postgres.query(`
            SELECT "mask", "code", "checksum", "pavadinimas"
            FROM public."bvpzKodai" ORDER BY "mask"
        `);
        syncBvpzRows(db, result.rows);
        const model = prepareModel(db, MODEL);
        if (model.reset) console.log(`Modelis pakeistas ${model.previous} → ${MODEL}; seni vektoriai išvalyti.`);

        const counts = getBvpzCounts(db);
        const target = Math.min(counts.visi - counts.suVektorium, LIMIT);
        console.log(
            `BVPŽ: ${nf(counts.visi)}, su vektoriumi: ${nf(counts.suVektorium)}, ` +
                `vektorizuosim: ${nf(target)}`,
        );
        if (target === 0) return;

        const embedder = createOllamaEmbedder({ url: URL, model: MODEL });
        console.log(`backend: ${embedder.url} model=${MODEL} concurrency=${CONCURRENCY} batch=${BATCH}`);
        const reader = createBvpzBeVektoriausReader(db, { batch: BATCH, limit: LIMIT });
        const writer = createBvpzVektoriuWriter(db);
        const stats = { ...newEmbedStats(), dimMismatch: 0 };
        const started = performance.now();
        const eta = new SlidingEta(started);
        let done = 0;
        let batchNr = 0;

        await runStream(reader, async (rows) => {
            const t0 = performance.now();
            const vectors = await embedder.embedBatch(rows.map((row) => row.pavadinimas), stats);
            const updates = rows.map((row, i) => {
                if (vectors[i].length !== EXPECTED_DIM) {
                    stats.dimMismatch++;
                    throw new Error(`${row.mask}: dimensija ${vectors[i].length}, laukta ${EXPECTED_DIM}`);
                }
                return { mask: row.mask, blob: vecToBlob(vectors[i]) };
            });
            writer.updateMany(updates);
            done += rows.length;
            batchNr++;
            const now = performance.now();
            eta.add(now, rows.length);
            console.log(
                `batch #${batchNr} (${rows.length}) ${secs(now - t0)}s | ${nf(done)}/${nf(target)}` +
                    (done < target ? ` | ETA ${eta.format(now, target - done)}` : ""),
            );
        }, CONCURRENCY);

        setMeta(db, "dim", EXPECTED_DIM);
        setMeta(db, "atnaujinta", new Date().toISOString());
        const elapsed = performance.now() - started;
        console.log(`Baigta: ${nf(done)} per ${secs(elapsed)}s (${(done / (elapsed / 1000)).toFixed(1)} vec/s).`);
    } finally {
        await postgres.end();
        closeSqlite(db);
    }
}

main().catch((error) => {
    console.error("BVPŽ vektorizavimas nepavyko:", error);
    process.exitCode = 1;
});
