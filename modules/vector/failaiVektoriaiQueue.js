import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { postgres } from "../../postgres/postgres.js";
import { limitArg, numArg, parseArgs } from "../../utils/cliArgs.js";
import { keysetPages } from "../../utils/keysetPaginate.js";
import { eta, nf, pctOf, secs } from "../../utils/progress.js";
import { closeSqlite, removeSqlite } from "../../utils/sqlite.js";
import { runPool, setUvThreadpoolSize } from "../../utils/workerPool.js";
import { readFailaiFs } from "../failai/failaiFs.js";
import { chunkTekstas, getBgeM3Tokenizer } from "./bgeM3Chunkinimas.js";
import {
    createFailaiVektoriaiWriter,
    getApdorotuCount,
    getFailaiVektoriaiSqlitePath,
    getGabaluCount,
    getLastFailaiId,
    getSaltiniuCount,
    openFailaiVektoriaiSqlite,
} from "./failaiVektoriaiSqlite.js";

// cvpIs failų teksto → bge-m3 langų queue kūrimas (be embeddinimo). Failų sąrašą
// imam iš Postgres (failai WHERE saltinis='cvpIs'), tekstą iš failaiInfo FS objekto
// (readFailaiFs(failasHash).tekstas). Chunkinam į dedupinamus langus, sudedam į
// SQLite (gabalai + saltiniai), vektorius (BLOB) liks NULL. Einam didėjančia
// failai.id tvarka → nutrūkus tęsiam nuo paskutinio apdoroto id.
//
// Paleidimas:
//   npm run vector:queue -- --limit 500 --concurrency 16

const args = parseArgs(process.argv.slice(2));

const CONCURRENCY = numArg(args.concurrency, 16); // lygiagretūs FS skaitymai
const BATCH_SIZE = numArg(args.batch, 500); // failų per SQLite tranzakciją
const PAGE_SIZE = numArg(args.page, 5000); // failų per Postgres užklausą
const LIMIT = limitArg(args.limit);
const DB_PATH = typeof args.db === "string" ? args.db : getFailaiVektoriaiSqlitePath();
const RESTART = Boolean(args.restart);

// fs.readFile IR native tokenizerio encode/decode sukasi libuv threadpool'e, kurio
// default = 4 gijos → tik 4 branduoliai nepaisant CONCURRENCY.
setUvThreadpoolSize(CONCURRENCY);

function toInt(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** failaiInfo.tekstas paprastai stringas; kartais gali būti puslapių masyvas. */
function tekstasToString(tekstas) {
    if (tekstas == null) return null;
    if (Array.isArray(tekstas)) return tekstas.join("\n\n");
    return String(tekstas);
}

// Vienas keyset puslapis. fileHash imam atskira užklausa `WHERE id = ANY(...)` —
// kitaip planner'is renkasi Merge Join su filesInfoFiles ir skenuoja milijonus
// eilučių nuo pradžios (žr. EXPLAIN). Du index scan'ai (files_source_lookup_idx +
// PK lookup'ai) = akimirksnis.
async function fetchPage(cursor, pageSize) {
    const { rows } = await postgres.query(
        `SELECT f."id", f."sourceId0", f."sourceId1", f."sourceId2"
         FROM public.files f
         JOIN public."filesSourceTitles" st ON st.id = f."sourceTitleId"
         WHERE st.title = 'cvpIs'
           AND ($1::bigint IS NULL OR f."id" > $1)
         ORDER BY f."id"
         LIMIT $2`,
        [cursor, pageSize],
    );
    if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        const { rows: infoRows } = await postgres.query(
            `SELECT "id", "fileHash" AS "failasHash" FROM public."filesInfoFiles" WHERE "id" = ANY($1::bigint[])`,
            [ids],
        );
        const hashById = new Map(infoRows.map((r) => [r.id, r.failasHash]));
        for (const r of rows) r.failasHash = hashById.get(r.id) ?? null;
    }
    return rows;
}

/** Perskaito failaiInfo tekstą pagal failasHash (dedupinam skaitymą batch'e). */
async function loadTekstas(failasHash, fsCache, stats) {
    let promise = fsCache.get(failasHash);
    if (!promise) {
        promise = (async () => {
            const t0 = performance.now();
            const turinys = await readFailaiFs(failasHash);
            stats.readMs += performance.now() - t0;
            return tekstasToString(turinys?.tekstas ?? null);
        })();
        fsCache.set(failasHash, promise);
    }
    return promise;
}

/** Chunkinimas priklauso tik nuo teksto → dedupinam per failasHash (promise cache). */
function getChunks(failasHash, tekstas, tokenizer, chunkCache, stats) {
    let promise = chunkCache.get(failasHash);
    if (!promise) {
        promise = (async () => {
            const t0 = performance.now();
            const chunks = await chunkTekstas(tokenizer, tekstas);
            stats.chunkMs += performance.now() - t0;
            return chunks;
        })();
        chunkCache.set(failasHash, promise);
    }
    return promise;
}

/** Vieno batch'o apdorojimas → gabalai + saltiniai + apdoroti. */
async function processBatch(rows, tokenizer, stats) {
    const fsCache = new Map(); // failasHash → Promise<tekstas|null>
    const chunkCache = new Map(); // failasHash → Promise<chunks[]>

    const gabalai = [];
    const saltiniai = [];

    // Read (IO, libuv) + chunk (native tokenizer, NAPI threadpool) sukam lygiagrečiai:
    // abu async off-main-thread, tad CONCURRENCY darbininkų pasiskirsto po branduolius.
    await runPool(
        rows,
        async (row) => {
            if (!row.failasHash) {
                stats.beFailasHash++;
                return;
            }
            const tekstas = await loadTekstas(row.failasHash, fsCache, stats);
            if (!tekstas) {
                stats.tuscias++;
                return;
            }

            const chunks = await getChunks(row.failasHash, tekstas, tokenizer, chunkCache, stats);
            // cvpIs šaltinio ID `files` jau laiko išskaidytą po stulpelius:
            // sourceId0 = pirkimo ID, sourceId1 = failo ID, sourceId2 = versijos ID.
            const pirkimoId = toInt(row.sourceId0);
            const pirkimoFailoId = toInt(row.sourceId1);
            const pirkimoFailoVersijosId = toInt(row.sourceId2);

            for (const c of chunks) {
                gabalai.push({ hash: c.hash, tekstas: c.tekstas, tokenai: c.tokenai });
                saltiniai.push({
                    failaiId: row.id,
                    eile: c.eile,
                    hash: c.hash,
                    pirkimoId,
                    pirkimoFailoId,
                    pirkimoFailoVersijosId,
                });
            }
            stats.suChunkais++;
        },
        CONCURRENCY,
    );

    // Apdorotais žymim visus batch'o failus – ir tuos be teksto, kad tęsiant
    // nebandytume jų iš naujo.
    return { gabalai, saltiniai, apdorotiFailaiId: rows.map((row) => row.id) };
}

function newStats() {
    return { readMs: 0, chunkMs: 0, beFailasHash: 0, tuscias: 0, suChunkais: 0 };
}

async function main() {
    if (RESTART) {
        removeSqlite(DB_PATH);
        console.log(`--restart: ištrinta ${DB_PATH}`);
    }

    const db = openFailaiVektoriaiSqlite({ dbPath: DB_PATH });
    const writer = createFailaiVektoriaiWriter(db);

    console.log("Kraunam bge-m3 tokenizerį…");
    const tokenizer = getBgeM3Tokenizer();

    const startAfter = getLastFailaiId(db);
    const already = getApdorotuCount(db);
    console.log(
        `SQLite: ${DB_PATH} (jau ${nf(already)} failų apdorota, ` +
            `${nf(getGabaluCount(db))} gabalų, ${nf(getSaltiniuCount(db))} šaltinių)` +
            (startAfter ? `, tęsiam nuo id > ${startAfter}` : ""),
    );

    // COUNT(*) su saltinis filtru skenuoja ~220k indekso eilučių — brangu ir
    // testams nereikalinga. Skaičiuojam tik pilnam paleidimui (LIMIT = Infinity).
    let totalFailai = null;
    if (Number.isFinite(LIMIT)) {
        console.log(`(praleidžiam COUNT(*) nes --limit=${LIMIT}; „iš viso" bus „?")`);
    } else {
        const tc = performance.now();
        const { rows: countRows } = await postgres.query(
            `SELECT COUNT(*) AS c FROM public.files f
             WHERE f."sourceTitleId" = (SELECT id FROM public."filesSourceTitles" WHERE title = 'cvpIs')`,
        );
        totalFailai = Number(countRows[0].c);
        console.log(`COUNT(*): ${nf(totalFailai)} cvpIs failų per ${secs(performance.now() - tc)}s`);
    }
    const targetProcessed = totalFailai == null ? LIMIT : Math.min(totalFailai - already, LIMIT);
    const totalStr = totalFailai == null ? "?" : nf(totalFailai);
    console.log(`concurrency=${CONCURRENCY} batch=${BATCH_SIZE} page=${PAGE_SIZE}`);

    const total = newStats();
    let processed = 0;
    let gabaluIrasyta = 0;
    let saltiniuIrasyta = 0;
    let batchNr = 0;
    let pgMsTotal = 0;
    let sqliteMsTotal = 0;
    const t0 = performance.now();

    // prefetch: kitą Postgres puslapį traukiam jau apdorojant dabartinį.
    const pages = keysetPages(fetchPage, { pageSize: PAGE_SIZE, startAfter, prefetch: true });

    outer: for await (const { rows, pgMs } of pages) {
        pgMsTotal += pgMs;
        console.log(`Postgres puslapis: ${nf(rows.length)} failų per ${secs(pgMs)}s`);

        for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
            const slice = rows.slice(offset, offset + BATCH_SIZE).slice(0, LIMIT - processed);
            if (slice.length === 0) break outer;

            batchNr++;
            const stats = newStats();
            const bt0 = performance.now();

            const { gabalai, saltiniai, apdorotiFailaiId } = await processBatch(slice, tokenizer, stats);

            const st0 = performance.now();
            writer.insertMany({ gabalai, saltiniai, apdorotiFailaiId });
            const sqliteMs = performance.now() - st0;

            processed += slice.length;
            gabaluIrasyta += gabalai.length;
            saltiniuIrasyta += saltiniai.length;
            sqliteMsTotal += sqliteMs;
            for (const key of Object.keys(total)) total[key] += stats[key];

            const batchMs = performance.now() - bt0;
            const elapsed = performance.now() - t0;

            // read/chunk – suma per visus lygiagrečius darbininkus (persidengia, tad
            // > wall). wall – realus batch'o laikas; sqlite – rašymo tranzakcija.
            console.log(
                `#${batchNr} ${nf(already + processed)}/${totalStr} ` +
                    `| wall ${secs(batchMs)}s (${(slice.length / (batchMs / 1000)).toFixed(0)} f/s) ` +
                    `| read ${secs(stats.readMs)}s + chunk ${secs(stats.chunkMs)}s (Σdarbininkai) + sqlite ${sqliteMs.toFixed(0)}ms ` +
                    `| +${gabalai.length} gab. +${saltiniai.length} šalt. ` +
                    `| vid ${(processed / (elapsed / 1000)).toFixed(0)} f/s, ETA ${eta(processed, targetProcessed, elapsed)}` +
                    (stats.beFailasHash ? ` | beFailasHash ${stats.beFailasHash}` : "") +
                    (stats.tuscias ? ` | tuščių ${stats.tuscias}` : ""),
            );

            if (processed >= LIMIT) break outer;
        }
    }

    const elapsed = performance.now() - t0;
    const dbBytes = fs.statSync(DB_PATH).size;
    console.log(
        `\n═══ Baigta per ${secs(elapsed)}s ═══\n` +
            `Failai: ${nf(processed)} apdorota ` +
            `(su chunkais ${total.suChunkais}, be failasHash ${total.beFailasHash}, tuščių ${total.tuscias})\n` +
            `Įrašyta: ${nf(gabaluIrasyta)} gabalų (su dublikatais), ${nf(saltiniuIrasyta)} šaltinių\n` +
            `Bazėj: ${nf(getGabaluCount(db))} unikalių gabalų, ` +
            `${nf(getSaltiniuCount(db))} šaltinių, SQLite ${(dbBytes / 1024 / 1024).toFixed(1)}MB\n` +
            `Laikų suvestinė (dalis nuo wall):\n` +
            `  pg (Postgres puslapiai)   ${secs(pgMsTotal).padStart(8)}s  ${pctOf(pgMsTotal, elapsed).padStart(4)}\n` +
            `  read (failaiInfo FS)      ${secs(total.readMs).padStart(8)}s  ${pctOf(total.readMs, elapsed).padStart(4)}  (Σdarbininkai)\n` +
            `  chunk (bge-m3 tokenize)   ${secs(total.chunkMs).padStart(8)}s  ${pctOf(total.chunkMs, elapsed).padStart(4)}  (Σdarbininkai)\n` +
            `  sqlite (rašymas)          ${secs(sqliteMsTotal).padStart(8)}s  ${pctOf(sqliteMsTotal, elapsed).padStart(4)}\n` +
            `  wall (viso)               ${secs(elapsed).padStart(8)}s  ${(processed / (elapsed / 1000)).toFixed(1)} f/s`,
    );

    closeSqlite(db);
    await postgres.end();
}

main().catch((error) => {
    console.error("failaiVektoriaiQueue nulūžo:", error);
    process.exitCode = 1;
});
