import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import zlib from "node:zlib";
import { postgres } from "../../postgres/postgres.js";
import { limitArg, numArg, parseArgs } from "../../utils/cliArgs.js";
import { keysetPages } from "../../utils/keysetPaginate.js";
import { eta, mb, nf, secs } from "../../utils/progress.js";
import { closeSqlite, removeSqlite } from "../../utils/sqlite.js";
import { runPool, setUvThreadpoolSize } from "../../utils/workerPool.js";
import { getFailaiPath } from "./failaiFs.js";
import {
    createFailaiInfoWriter,
    getFailaiInfoSqlitePath,
    getLastHash,
    getRowCount,
    openFailaiInfoSqlite,
} from "./failaiInfoSqlite.js";

// Eksperimentinis migravimas: failaiInfo folder tree (md5 → .json) → SQLite + zstd blob.
// Failų sąrašą imam iš DB (filesInfoFiles."fileHash"), ne iš FS – tik tie hash'ai
// realiai naudojami. Einam didėjančia hash tvarka, todėl nutrūkus galima tęsti nuo
// paskutinio įrašyto hash.
//
// Paleidimas:
//   npm run failai:info-to-sqlite -- --limit 200000 --concurrency 32 --level 3
//
// zstdCompress (async) suka libuv threadpool'e, t. y. ne main thread – kiek jų bus,
// valdo UV_THREADPOOL_SIZE (nustatom pagal --concurrency).

const args = parseArgs(process.argv.slice(2));

const CONCURRENCY = numArg(args.concurrency, 32); // lygiagretūs read+compress
const BATCH_SIZE = numArg(args.batch, 2000); // eilučių per SQLite tranzakciją
const PAGE_SIZE = numArg(args.page, 50000); // hash'ų per Postgres užklausą
const LEVEL = numArg(args.level, 3); // zstd kompresijos lygis
const LIMIT = limitArg(args.limit);
const DB_PATH = typeof args.db === "string" ? args.db : getFailaiInfoSqlitePath();
const RESTART = Boolean(args.restart);

// Turi būti nustatyta prieš pirmą threadpool panaudojimą.
setUvThreadpoolSize(CONCURRENCY);

const zstdCompress = promisify(zlib.zstdCompress);
const ZSTD_OPTS = { params: { [zlib.constants.ZSTD_c_compressionLevel]: LEVEL } };

/** Vienas puslapis DISTINCT hash'ų didėjančia tvarka (keyset – be OFFSET). */
async function fetchHashPage(cursor, pageSize) {
    const { rows } = await postgres.query(
        `SELECT DISTINCT "fileHash" AS "failasHash"
         FROM public."filesInfoFiles"
         WHERE "fileHash" IS NOT NULL
           AND ($1::text IS NULL OR "fileHash" > $1)
         ORDER BY "fileHash"
         LIMIT $2`,
        [cursor, pageSize],
    );
    return rows;
}

/** Perskaito ir suspaudžia vieną hash'ą. */
async function loadOne(hash, stats) {
    const filePath = getFailaiPath(hash);
    let raw;
    try {
        const t0 = performance.now();
        raw = await fs.promises.readFile(filePath);
        stats.readMs += performance.now() - t0;
    } catch (error) {
        if (error.code === "ENOENT") {
            stats.missing++;
            return null;
        }
        stats.errors++;
        console.error(`Nepavyko perskaityti ${filePath}:`, error.message);
        return null;
    }

    const t1 = performance.now();
    const turinys = await zstdCompress(raw, ZSTD_OPTS);
    stats.zstdMs += performance.now() - t1;

    stats.rawBytes += raw.byteLength;
    stats.zstdBytes += turinys.byteLength;
    return { hash, dydis: raw.byteLength, turinys };
}

function newStats() {
    return { readMs: 0, zstdMs: 0, rawBytes: 0, zstdBytes: 0, missing: 0, errors: 0 };
}

async function main() {
    if (RESTART) {
        removeSqlite(DB_PATH);
        console.log(`--restart: ištrinta ${DB_PATH}`);
    }

    const db = openFailaiInfoSqlite({ dbPath: DB_PATH });
    const writer = createFailaiInfoWriter(db);

    const startAfter = getLastHash(db);
    const already = getRowCount(db);
    console.log(
        `SQLite: ${DB_PATH} (jau ${nf(already)} eilučių)` +
            (startAfter ? `, tęsiam nuo hash > ${startAfter}` : ""),
    );

    const { rows: countRows } = await postgres.query(
        `SELECT COUNT(DISTINCT "fileHash") AS c FROM public."filesInfoFiles" WHERE "fileHash" IS NOT NULL`,
    );
    const totalHashes = Math.min(Number(countRows[0].c), already + LIMIT);
    console.log(
        `Postgres: ${nf(countRows[0].c)} unikalių hash'ų; ` +
            `concurrency=${CONCURRENCY} batch=${BATCH_SIZE} page=${PAGE_SIZE} zstd=lvl${LEVEL}`,
    );

    const total = newStats();
    let processed = 0;
    let inserted = 0;
    let batchNr = 0;
    let sqliteMsTotal = 0;
    let pgMsTotal = 0;
    const t0 = performance.now();

    const pages = keysetPages(fetchHashPage, {
        pageSize: PAGE_SIZE,
        startAfter,
        getCursor: (row) => row.failasHash,
    });

    outer: for await (const { rows: hashRows, pgMs } of pages) {
        pgMsTotal += pgMs;
        const hashes = hashRows.map((r) => r.failasHash);

        for (let offset = 0; offset < hashes.length; offset += BATCH_SIZE) {
            const slice = hashes.slice(offset, offset + BATCH_SIZE).slice(0, LIMIT - processed);
            if (slice.length === 0) break outer;

            batchNr++;
            const stats = newStats();
            const bt0 = performance.now();

            const rows = (await runPool(slice, (hash) => loadOne(hash, stats), CONCURRENCY)).filter(Boolean);
            const loadMs = performance.now() - bt0;

            const st0 = performance.now();
            writer.insertMany(rows);
            const sqliteMs = performance.now() - st0;

            processed += slice.length;
            inserted += rows.length;
            sqliteMsTotal += sqliteMs;
            for (const key of Object.keys(total)) total[key] += stats[key];

            const batchMs = performance.now() - bt0;
            const elapsed = performance.now() - t0;
            const ratio = stats.zstdBytes ? (stats.rawBytes / stats.zstdBytes).toFixed(2) : "-";

            console.log(
                `#${batchNr} ${nf(already + processed)}/${nf(totalHashes)} ` +
                    `| ${(slice.length / (batchMs / 1000)).toFixed(0)} f/s ` +
                    `| ${mb(stats.rawBytes)}MB → ${mb(stats.zstdBytes)}MB (${ratio}x) ` +
                    `| read ${secs(stats.readMs)}s zstd ${secs(stats.zstdMs)}s (wall ${secs(loadMs)}s) ` +
                    `sqlite ${sqliteMs.toFixed(0)}ms pg ${pgMs.toFixed(0)}ms ` +
                    `| ~${(processed / (elapsed / 1000)).toFixed(0)} f/s vid., ETA ${eta(processed, totalHashes - already, elapsed)}` +
                    (stats.missing ? ` | trūksta ${stats.missing}` : "") +
                    (stats.errors ? ` | klaidų ${stats.errors}` : ""),
            );

            if (processed >= LIMIT) break outer;
        }
    }

    const elapsed = performance.now() - t0;
    const dbBytes = fs.statSync(DB_PATH).size;
    console.log(
        `\nBaigta per ${secs(elapsed)}s: ${nf(processed)} hash'ų, ` +
            `įrašyta ${nf(inserted)}, trūko ${total.missing}, klaidų ${total.errors}\n` +
            `Turinys: ${mb(total.rawBytes)}MB → ${mb(total.zstdBytes)}MB ` +
            `(${total.zstdBytes ? (total.rawBytes / total.zstdBytes).toFixed(2) : "-"}x), ` +
            `SQLite failas ${mb(dbBytes)}MB\n` +
            `Laikai: read ${secs(total.readMs)}s, zstd ${secs(total.zstdMs)}s (threadpool), ` +
            `sqlite ${secs(sqliteMsTotal)}s, pg ${secs(pgMsTotal)}s, wall ${secs(elapsed)}s\n` +
            `Vidutiniškai ${(processed / (elapsed / 1000)).toFixed(0)} failų/s`,
    );

    closeSqlite(db);
    await postgres.end();
}

main().catch((error) => {
    console.error("failaiInfoToSqlite nulūžo:", error);
    process.exitCode = 1;
});
