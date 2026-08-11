import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// Bendras node:sqlite bazių atidarymas su vienodomis performance pragmomis.
// Naudoja failaiInfo (zstd blob'ai) ir failaiVektoriai (gabalai + vektoriai) –
// abiem tinka tas pats profilis: WAL (daug skaitytojų iš skirtingų procesų, vienas
// rašytojas), didelis puslapių cache ir mmap skaitymui.

export const DEFAULT_SQLITE_PRAGMAS = {
    pageSize: 8192, // veikia tik kol bazė tuščia, todėl nustatom pirmiausiai
    busyTimeout: 15000,
    cacheSize: -262144, // ~256 MB puslapių cache
    mmapSize: 8589934592, // 8 GB mmap skaitymui
};

/**
 * Atidaro (jei reikia – sukuria) SQLite bazę su bendromis pragmomis.
 * @param {Object} opts
 * @param {string} opts.dbPath - pilnas kelias iki .sqlite failo
 * @param {boolean} [opts.readonly] - skaitytojams (keli procesai lygiagrečiai)
 * @param {(db: DatabaseSync) => void} [opts.ensureSchema] - kviečiama tik rašymo režimu
 * @param {Partial<typeof DEFAULT_SQLITE_PRAGMAS>} [opts.pragmas]
 * @param {"OFF"|"NORMAL"|"FULL"} [opts.synchronous] - write patvarumas.
 * @returns {DatabaseSync}
 */
export function openSqlite({
    dbPath,
    readonly = false,
    ensureSchema,
    pragmas,
    synchronous = readonly ? "NORMAL" : "OFF",
} = {}) {
    const p = { ...DEFAULT_SQLITE_PRAGMAS, ...pragmas };
    if (!readonly) fs.mkdirSync(path.dirname(dbPath), { recursive: true });

    const db = new DatabaseSync(dbPath, { readOnly: readonly });

    if (!readonly) db.exec(`PRAGMA page_size = ${p.pageSize}`);
    db.exec(`PRAGMA busy_timeout = ${p.busyTimeout}`);
    // journal_mode keičia failo antraštę, t. y. yra RAŠYMAS — readonly ryšiui jis
    // nulūžta („attempt to write a readonly database"), jei bazė dar ne WAL.
    // Skaitytojui jo ir nereikia: režimas yra failo savybė, ne ryšio.
    if (!readonly) db.exec("PRAGMA journal_mode = WAL");
    if (!["OFF", "NORMAL", "FULL"].includes(synchronous)) {
        throw new Error(`Blogas SQLite synchronous režimas: ${synchronous}`);
    }
    db.exec(`PRAGMA synchronous = ${synchronous}`);
    db.exec("PRAGMA temp_store = MEMORY");
    db.exec(`PRAGMA cache_size = ${p.cacheSize}`);
    db.exec(`PRAGMA mmap_size = ${p.mmapSize}`);

    if (!readonly && ensureSchema) ensureSchema(db);
    return db;
}

/**
 * Įvykdo `fn()` vienoj tranzakcijoj. Be jos kiekvienas INSERT yra atskiras fsync'as
 * ir masinis rašymas miršta. `fn` turi būti SINCHRONIŠKA (jokio await tarp
 * BEGIN/COMMIT) – kitaip įsiterps kito darbininko užklausos.
 * @template T
 * @param {DatabaseSync} db
 * @param {() => T} fn
 * @returns {T}
 */
export function inTransaction(db, fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
        const result = fn();
        db.exec("COMMIT");
        return result;
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
}

/** Suglaudina WAL į pagrindinį failą – kviečiam prieš uždarant po masinio rašymo. */
export function closeSqlite(db) {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
}

/** Ištrina bazę kartu su WAL/SHM palydovais (--restart režimui). */
export function removeSqlite(dbPath) {
    for (const suffix of ["", "-wal", "-shm"]) {
        fs.rmSync(dbPath + suffix, { force: true });
    }
}
