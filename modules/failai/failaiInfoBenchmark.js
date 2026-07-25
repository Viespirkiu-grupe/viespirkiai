import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import zlib from "node:zlib";
import sqlite3pkg from "sqlite3";
import { postgres } from "../../postgres/postgres.js";
import { numArg, parseArgs } from "../../utils/cliArgs.js";
import { mb } from "../../utils/progress.js";
import { runPool, setUvThreadpoolSize } from "../../utils/workerPool.js";
import { getFailaiPath } from "./failaiFs.js";
import { getFailaiInfoSqlitePath } from "./failaiInfoSqlite.js";

// Eksperimentinis benchmark'as: DB paima N atsitiktinių hash'ų ir daro random skaitymus
//   1) per seną FS folder tree (readFile),
//   2) per SQLite (node-sqlite3, NEblokuojantis – užklausos suka libuv threadpool'e),
// abu su vienoda concurrency eile. Palygina rezultatus konsolėj.
//
// PASTABA: reikalauja `sqlite3` paketo (node-sqlite3), kuris NĖRA package.json
// priklausomybėse – prieš paleidžiant `npm i -D sqlite3`. node:sqlite (įmontuotas)
// čia netinka, nes jis sinchroniškas ir concurrency matavimas neturėtų prasmės.
//
//   npm run failai:info-benchmark -- --n 1000 --concurrency 100

const args = parseArgs(process.argv.slice(2));
const N = numArg(args.n, 1000);
const CONCURRENCY = numArg(args.concurrency, 100);
// lygiagrečių SQLite jungčių (node-sqlite3 serializuoja per jungtį); sweet spot ~64
const POOL = numArg(args.pool, 64);
const DB_PATH = typeof args.db === "string" ? args.db : getFailaiInfoSqlitePath();

// Threadpool turi talpinti ir sqlite skaitymus, ir zstd dekompresijas – imam su atsarga.
setUvThreadpoolSize(Math.max(CONCURRENCY, POOL) + 8);

const zstdDecompress = promisify(zlib.zstdDecompress);

/** Bendra concurrency eilė su latency matavimu kiekvienam elementui. */
async function runQueue(items, task) {
    const wall0 = performance.now();
    const latencies = await runPool(
        items,
        async (item) => {
            const t0 = performance.now();
            const res = await task(item);
            return { ms: performance.now() - t0, ...res };
        },
        CONCURRENCY,
    );
    return { wallMs: performance.now() - wall0, latencies };
}

function summarize(label, wallMs, latencies) {
    const ok = latencies.filter((l) => l.ok);
    const bytes = ok.reduce((s, l) => s + (l.bytes || 0), 0);
    const ms = latencies.map((l) => l.ms).sort((a, b) => a - b);
    const pct = (p) => ms[Math.min(ms.length - 1, Math.floor((p / 100) * ms.length))];
    const avg = ms.reduce((s, v) => s + v, 0) / ms.length;
    return {
        label,
        wallMs,
        found: ok.length,
        missing: latencies.length - ok.length,
        bytes,
        rps: latencies.length / (wallMs / 1000),
        avg,
        p50: pct(50),
        p95: pct(95),
        p99: pct(99),
        max: ms[ms.length - 1],
    };
}

function printSummary(s) {
    console.log(
        `\n${s.label}\n` +
            `  wall ${(s.wallMs / 1000).toFixed(2)}s | ${s.rps.toFixed(0)} skait./s | ` +
            `rasta ${s.found}, trūksta ${s.missing} | ${mb(s.bytes)}MB dekoduota\n` +
            `  latency ms: avg ${s.avg.toFixed(2)} p50 ${s.p50.toFixed(2)} ` +
            `p95 ${s.p95.toFixed(2)} p99 ${s.p99.toFixed(2)} max ${s.max.toFixed(2)}`,
    );
}

async function main() {
    console.log(`Renkam ${N} atsitiktinių hash'ų iš filesInfoFiles...`);
    const { rows } = await postgres.query(
        `SELECT "fileHash" AS "failasHash" FROM public."filesInfoFiles"
         WHERE "fileHash" IS NOT NULL
         ORDER BY random() LIMIT $1`,
        [N],
    );
    const hashes = rows.map((r) => r.failasHash);
    console.log(`Gauta ${hashes.length} hash'ų. Concurrency=${CONCURRENCY}, DB=${DB_PATH}\n`);

    // --- FS skaitymas ---
    const fsRun = await runQueue(hashes, async (hash) => {
        try {
            const buf = await fs.promises.readFile(getFailaiPath(hash));
            JSON.parse(buf.toString("utf8")); // pilnas darbas kaip realiam skaityme
            return { ok: true, bytes: buf.byteLength };
        } catch (error) {
            if (error.code === "ENOENT") return { ok: false };
            throw error;
        }
    });
    const fsSum = summarize("FS (folder tree readFile)", fsRun.wallMs, fsRun.latencies);

    // --- SQLite (non-blocking node-sqlite3) ---
    // node-sqlite3 serializuoja visas užklausas per VIENĄ Database objektą, todėl
    // concurrency prasmę įgauna tik turint jungčių pool'ą – kiekviena jungtis atleidžia
    // libuv threadpool'ą per sqlite3_step, tad kelios jungtys skaito tikrai lygiagrečiai.
    const sqlite3 = sqlite3pkg; // .verbose() prideda stack capture kiekvienai užklausai – lėta
    const poolSize = Math.max(1, Math.min(POOL, CONCURRENCY));

    async function openConn() {
        const conn = await new Promise((resolve, reject) => {
            const d = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) =>
                err ? reject(err) : resolve(d),
            );
        });
        const run = promisify(conn.run.bind(conn));
        // Perf pragmos kiekvienai jungčiai atskirai (cache/mmap yra per-connection).
        await run("PRAGMA busy_timeout = 15000");
        await run("PRAGMA cache_size = -65536"); // ~64 MB puslapių cache jungčiai
        // mmap IŠJUNGTAS sąmoningai: N jungčių × didelis mmap ant 43GB failo → major
        // page-fault audra ir 10s+ uodegos. pread + OS page cache čia ~5x greitesnis.
        await run("PRAGMA mmap_size = 0");
        // Prepared statement paruošiam kartą ir naudojam pakartotinai.
        const stmt = conn.prepare(`SELECT "turinys" FROM "failaiInfo" WHERE "hash" = ?`);
        return { conn, stmt, get: promisify(stmt.get.bind(stmt)) };
    }

    const pool = await Promise.all(Array.from({ length: poolSize }, openConn));
    let rr = 0;

    const sqRun = await runQueue(hashes, async (hash) => {
        const slot = pool[rr++ % pool.length]; // round-robin per jungtis
        const row = await slot.get(hash);
        if (!row) return { ok: false };
        const buf = await zstdDecompress(row.turinys); // dekompresija taip pat threadpool'e
        JSON.parse(buf.toString("utf8"));
        return { ok: true, bytes: buf.byteLength };
    });
    const sqSum = summarize(
        `SQLite (node-sqlite3 x${poolSize} jungtys + zstd, non-blocking)`,
        sqRun.wallMs,
        sqRun.latencies,
    );
    await Promise.all(
        pool.map(
            (slot) =>
                new Promise((res) => slot.stmt.finalize(() => slot.conn.close(res))),
        ),
    );

    printSummary(fsSum);
    printSummary(sqSum);

    // --- Palyginimas ---
    const speedup = fsSum.wallMs / sqSum.wallMs;
    const bothFound = fsSum.found === sqSum.found;
    console.log(
        `\n=== Palyginimas (${N} skaitymų, concurrency ${CONCURRENCY}) ===\n` +
            `  Throughput: FS ${fsSum.rps.toFixed(0)} vs SQLite ${sqSum.rps.toFixed(0)} skait./s ` +
            `→ SQLite ${speedup >= 1 ? speedup.toFixed(2) + "x greičiau" : (1 / speedup).toFixed(2) + "x lėčiau"}\n` +
            `  p50 latency: FS ${fsSum.p50.toFixed(2)}ms vs SQLite ${sqSum.p50.toFixed(2)}ms\n` +
            `  p99 latency: FS ${fsSum.p99.toFixed(2)}ms vs SQLite ${sqSum.p99.toFixed(2)}ms\n` +
            `  Rasta: FS ${fsSum.found}, SQLite ${sqSum.found} ` +
            `${bothFound ? "(sutampa)" : "(⚠ NESUTAMPA – gal SQLite dar nemigruotas iki galo)"}`,
    );

    await postgres.end();
}

main().catch((error) => {
    console.error("Benchmark nulūžo:", error);
    process.exitCode = 1;
});
