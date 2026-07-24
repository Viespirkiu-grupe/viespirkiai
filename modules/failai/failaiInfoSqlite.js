import path from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { closeSqlite, inTransaction, openSqlite } from "../../utils/sqlite.js";

// Eksperimentinė failaiInfo saugykla: vietoj milijonų mažų .json failų folder tree
// (md5 → /f/a/i/l/a/<md5>.json) laikom viską vienoje SQLite lentelėje, turinys
// suspaustas zstd. WAL režimas → daug lygiagrečių skaitytojų iš skirtingų procesų
// (vienas rašytojas vienu metu, kaip visada SQLite).

export const FAILAI_INFO_SQLITE_DIR = "/flashas/viespirkiai/failaiInfoSqlite";
export const FAILAI_INFO_SQLITE_FILE = "failaiInfo.sqlite";

export function getFailaiInfoSqlitePath(dir = FAILAI_INFO_SQLITE_DIR) {
    return path.join(dir, FAILAI_INFO_SQLITE_FILE);
}

/**
 * Atidaro (jei reikia – sukuria) failaiInfo SQLite bazę.
 * @param {Object} [opts]
 * @param {string} [opts.dbPath] - pilnas kelias iki .sqlite failo
 * @param {boolean} [opts.readonly] - skaitytojams (keli procesai lygiagrečiai)
 * @returns {import("node:sqlite").DatabaseSync}
 */
export function openFailaiInfoSqlite({ dbPath = getFailaiInfoSqlitePath(), readonly = false } = {}) {
    return openSqlite({ dbPath, readonly, ensureSchema: ensureFailaiInfoSchema });
}

export { closeSqlite };

export function ensureFailaiInfoSchema(db) {
    // hash = failaiInfoFailai."failasHash" (md5 hex nuo sujungto turinio JSON).
    // dydis – originalaus JSON baitai, suspaustas – blob'o baitai (statistikai/ratio).
    db.exec(`
        CREATE TABLE IF NOT EXISTS "failaiInfo" (
            "hash" TEXT PRIMARY KEY,
            "dydis" INTEGER NOT NULL,
            "suspaustas" INTEGER NOT NULL,
            "turinys" BLOB NOT NULL
        ) STRICT
    `);
}

/**
 * Paskutinis (didžiausias) jau įrašytas hash – tęsimui, nes einam didėjančia tvarka.
 * Hex hash'ų rūšiavimas SQLite'e ir Postgres'e (C collation) sutampa.
 */
export function getLastHash(db) {
    const row = db.prepare(`SELECT MAX("hash") AS h FROM "failaiInfo"`).get();
    return row?.h ?? null;
}

export function getRowCount(db) {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM "failaiInfo"`).get().c);
}

/** Bendra statistika (dydžiai/ratio) – naudinga po migracijos. */
export function getFailaiInfoStats(db) {
    const row = db
        .prepare(`SELECT COUNT(*) c, SUM("dydis") raw, SUM("suspaustas") zstd FROM "failaiInfo"`)
        .get();
    return {
        count: Number(row.c),
        rawBytes: Number(row.raw ?? 0),
        zstdBytes: Number(row.zstd ?? 0),
    };
}

/**
 * Paruošia paketinį rašytoją. Rašom vienoj tranzakcijoj – kitaip kiekvienas INSERT
 * yra atskiras fsync'as ir viskas miršta.
 */
export function createFailaiInfoWriter(db) {
    const stmt = db.prepare(
        `INSERT INTO "failaiInfo" ("hash", "dydis", "suspaustas", "turinys")
         VALUES (?, ?, ?, ?)
         ON CONFLICT("hash") DO UPDATE SET
             "dydis" = excluded."dydis",
             "suspaustas" = excluded."suspaustas",
             "turinys" = excluded."turinys"`,
    );

    return {
        /** @param {{hash: string, dydis: number, turinys: Uint8Array}[]} rows */
        insertMany(rows) {
            inTransaction(db, () => {
                for (const row of rows) {
                    stmt.run(row.hash, row.dydis, row.turinys.byteLength, row.turinys);
                }
            });
        },
    };
}

/**
 * Skaitymas – ekvivalentas readFailaiFs(hash), tik iš SQLite.
 * @returns {Object|null}
 */
export function readFailaiInfoSqlite(db, hash) {
    if (!hash) return null;
    const row = db.prepare(`SELECT "turinys" FROM "failaiInfo" WHERE "hash" = ?`).get(hash);
    if (!row) return null;
    const json = zstdDecompressSync(row.turinys).toString("utf8");
    return json === "" ? null : JSON.parse(json);
}
