import { performance } from "node:perf_hooks";
import { limitArg, numArg, parseArgs } from "../../utils/cliArgs.js";
import { nf, secs, SlidingEta } from "../../utils/progress.js";
import { closeSqlite } from "../../utils/sqlite.js";
import { runStream } from "../../utils/workerPool.js";
import {
    createBeVektoriausReader,
    createVektoriuWriter,
    getBeVektoriausCount,
    getFailaiVektoriaiSqlitePath,
    openFailaiVektoriaiSqlite,
} from "./failaiVektoriaiSqlite.js";
import {
    createOllamaEmbedder,
    DEFAULT_EMBED_MODEL,
    DEFAULT_OLLAMA_URL,
    newEmbedStats,
} from "./ollamaEmbed.js";
import { BGE_M3_DIM, vecToBlob } from "./vektoriai.js";

// gabalai.tekstas → bge-m3 embedding (per Ollama) → float32 BLOB į gabalai.vektorius.
// Imam tik neužpildytus (vektorius IS NULL), tad paleidus iš naujo tęsia savaime.
// Concurrency × batch derinam prie backend'o: vienas Ollama arba N Ollamų už
// Caddy least-conn balansuotojo (kad GPU būtų pilnai užimti).
//
//   # paprastai (vienas Ollama):
//   npm run vector:embed -- --url http://192.168.255.99:11434
//
//   # rimtai (8 Ollamos už Caddy least-conn):
//   npm run vector:embed -- --url http://192.168.255.99:80 --concurrency 8 --batch 25

const args = parseArgs(process.argv.slice(2));
const DB_PATH = typeof args.db === "string" ? args.db : getFailaiVektoriaiSqlitePath();
const URL = typeof args.url === "string" ? args.url : DEFAULT_OLLAMA_URL;
const MODEL = typeof args.model === "string" ? args.model : DEFAULT_EMBED_MODEL;
const CONCURRENCY = numArg(args.concurrency, 1);
const BATCH = numArg(args.batch, 25);
const LIMIT = limitArg(args.limit); // gabalų riba (testams)
const RETRIES = numArg(args.retries, 5);
const EXPECTED_DIM = numArg(args.dim, BGE_M3_DIM);

async function main() {
    const db = openFailaiVektoriaiSqlite({ dbPath: DB_PATH });
    const embedder = createOllamaEmbedder({ url: URL, model: MODEL, retries: RETRIES });
    const writer = createVektoriuWriter(db);

    // Antraštę spausdinam IŠ KARTO, kad iš karto matytųsi su kuo dirbam.
    console.log(`═══ ${DB_PATH} ═══`);
    console.log(`backend: ${embedder.url} model=${embedder.model} concurrency=${CONCURRENCY} batch=${BATCH}`);

    process.stdout.write(`Skaičiuoju likutį… `);
    const tc = performance.now();
    const liko0 = getBeVektoriausCount(db);
    const target = Math.min(liko0, LIMIT);
    console.log(`be vektoriaus ${nf(liko0)} (vektorizuosim ${nf(target)}) [${secs(performance.now() - tc)}s]`);
    if (target === 0) {
        console.log("Nieko vektorizuoti — viskas jau turi vektorius.");
        db.close();
        return;
    }
    const targetStr = nf(target);

    const stats = { ...newEmbedStats(), dimMismatch: 0 };
    let done = 0;
    let batchNr = 0;
    let sqliteMsTotal = 0;
    const t0 = performance.now();
    const slid = new SlidingEta(t0);

    // Nuolatinis pipeline BE barjero: darbininkai patys traukia kitą batch'ą vos baigę.
    // Lėta Ollama stabdo tik SAVO darbininką — kiti 7 nelaukia (least-conn nauda išlieka).
    const nextBatch = createBeVektoriausReader(db, {
        batch: BATCH,
        refill: CONCURRENCY * BATCH * 4,
        limit: LIMIT,
    });

    await runStream(
        nextBatch,
        async (batch) => {
            const wt0 = performance.now();
            const embeddings = await embedder.embedBatch(
                batch.map((r) => r.tekstas),
                stats,
            );
            const batchMs = performance.now() - wt0;

            // Sinchroniškas rašymas (be await tarp BEGIN/COMMIT) — saugu vienoj JS gijoj.
            const st0 = performance.now();
            writer.updateMany(
                batch.map((row, j) => {
                    const vec = embeddings[j];
                    if (vec.length !== EXPECTED_DIM) stats.dimMismatch++;
                    return { hash: row.hash, blob: vecToBlob(vec) };
                }),
            );
            sqliteMsTotal += performance.now() - st0;

            done += batch.length;
            batchNr++;
            const now = performance.now();
            slid.add(now, batch.length);
            console.log(
                `batch #${batchNr} (${batch.length}) ${secs(batchMs)}s ${(batch.length / (batchMs / 1000)).toFixed(0)} vec/s ` +
                    `| ${nf(done)}/${targetStr} | ETA ${slid.format(now, target - done)}` +
                    (stats.retries ? ` | retries ${stats.retries}` : "") +
                    (stats.dimMismatch ? ` | dim≠${EXPECTED_DIM}: ${stats.dimMismatch}` : ""),
            );
        },
        CONCURRENCY,
    );

    const elapsed = performance.now() - t0;
    console.log(
        `\n═══ Baigta per ${secs(elapsed)}s ═══\n` +
            `Vektorizuota: ${nf(done)} gabalų, ${(done / (elapsed / 1000)).toFixed(1)} vec/s\n` +
            `http Σ ${secs(stats.httpMs)}s, sqlite ${secs(sqliteMsTotal)}s, retries ${stats.retries}, ` +
            `dim≠${EXPECTED_DIM}: ${stats.dimMismatch}\n` +
            `Liko be vektoriaus: ${nf(getBeVektoriausCount(db))}`,
    );

    closeSqlite(db);
}

main().catch((error) => {
    console.error("failaiVektoriaiEmbed nulūžo:", error);
    process.exitCode = 1;
});
