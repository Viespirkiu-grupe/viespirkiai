import { promisify } from "node:util";
import zlib from "node:zlib";
import fs from "node:fs";
import { inTransaction, openSqlite } from "./sqlite.js";
import { sidecarDbPath, sidecarKeyColumn, sidecarTable } from "./sidecarPaths.js";

const zstdCompress = promisify(zlib.zstdCompress);
const zstdDecompress = promisify(zlib.zstdDecompress);
const ZSTD_OPTIONS = {
    params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 },
};

// Vienas ryšys konkrečiam DB failui ir lentelei viename procese. Kiti procesai
// turi savo ryšius; WAL ir busy_timeout suderina jų skaitymus bei rašymus.
const connections = new Map();

export function quoteIdentifier(value) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
        throw new Error(`Blogas SQLite identifikatorius: ${value}`);
    }
    return `"${value}"`;
}

export function ensureCompressedSidecarSchema(db, tableName, keyColumn = "hash") {
    const table = quoteIdentifier(tableName);
    const key = quoteIdentifier(keyColumn);
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${table} (
            ${key} TEXT PRIMARY KEY,
            "dydis" INTEGER NOT NULL,
            "suspaustas" INTEGER NOT NULL,
            "turinys" BLOB NOT NULL
        ) STRICT
    `);
}

function getWriteConnection(dbPath, tableName, keyColumn) {
    const cacheKey = `write\0${dbPath}\0${tableName}`;
    let cached = connections.get(cacheKey);
    if (cached) return cached;

    const table = quoteIdentifier(tableName);
    const key = quoteIdentifier(keyColumn);
    const db = openSqlite({
        dbPath,
        synchronous: "FULL",
        ensureSchema: (opened) => ensureCompressedSidecarSchema(opened, tableName, keyColumn),
    });
    cached = {
        db,
        read: db.prepare(`SELECT "turinys" FROM ${table} WHERE ${key} = ?`),
        // json_each: vienu indexed query paimam visą partiją ir neatsiremiam į
        // SQLite bind parametrų limitą.
        readMany: db.prepare(
            `SELECT ${key} AS "raktas", "turinys" FROM ${table}
             WHERE ${key} IN (SELECT value FROM json_each(?))`,
        ),
        upsert: db.prepare(
            `INSERT INTO ${table} (${key}, "dydis", "suspaustas", "turinys")
             VALUES (?, ?, ?, ?)
             ON CONFLICT(${key}) DO UPDATE SET
                 "dydis" = excluded."dydis",
                 "suspaustas" = excluded."suspaustas",
                 "turinys" = excluded."turinys"`,
        ),
        writable: true,
        pending: [],
        flushScheduled: false,
    };
    connections.set(cacheKey, cached);
    return cached;
}

function enqueueWrite(connection, row) {
    return new Promise((resolve, reject) => {
        connection.pending.push({ row, resolve, reject });
        if (connection.flushScheduled) return;
        connection.flushScheduled = true;
        // Vienu metu pasibaigusias async zstd užduotis sugrupuojam į vieną
        // tranzakciją, kad FULL režime nereikėtų fsync kiekvienam blob'ui.
        setImmediate(() => {
            connection.flushScheduled = false;
            const batch = connection.pending.splice(0);
            try {
                inTransaction(connection.db, () => {
                    for (const item of batch) {
                        const value = item.row;
                        connection.upsert.run(
                            value.key,
                            value.rawBytes,
                            value.compressed.byteLength,
                            value.compressed,
                        );
                    }
                });
                for (const item of batch) item.resolve();
            } catch (error) {
                for (const item of batch) item.reject(error);
            }
        });
    });
}

function getReadConnection(dbPath, tableName, keyColumn) {
    const write = connections.get(`write\0${dbPath}\0${tableName}`);
    if (write) return write;
    if (!fs.existsSync(dbPath)) return null;

    const cacheKey = `read\0${dbPath}\0${tableName}`;
    let cached = connections.get(cacheKey);
    if (cached) return cached;
    const table = quoteIdentifier(tableName);
    const key = quoteIdentifier(keyColumn);
    const db = openSqlite({ dbPath, readonly: true });
    cached = {
        db,
        read: db.prepare(`SELECT "turinys" FROM ${table} WHERE ${key} = ?`),
        readMany: db.prepare(
            `SELECT ${key} AS "raktas", "turinys" FROM ${table}
             WHERE ${key} IN (SELECT value FROM json_each(?))`,
        ),
        writable: false,
    };
    connections.set(cacheKey, cached);
    return cached;
}

/** Uždaro lazy ryšius; naudojama testuose ir tvarkingam proceso stabdymui. */
export function closeCompressedSqliteStores() {
    for (const connection of connections.values()) {
        try {
            if (connection.writable) connection.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
        } finally {
            connection.db.close();
        }
    }
    connections.clear();
}

/**
 * Zstd SQLite saugykla vienam registro sidecar'ui (`utils/sidecarPaths.js`).
 * Kelias ir lentelė išvedami iš vardo, todėl konfigūracijos raktų čia nebėra.
 */
export function createCompressedSqliteStore({ sidecar }) {
    const tableName = sidecarTable(sidecar);
    const keyColumn = sidecarKeyColumn(sidecar);

    return {
        configured() {
            return Boolean(sidecarDbPath(sidecar));
        },

        async readRaw(key) {
            const dbPath = sidecarDbPath(sidecar);
            if (!dbPath || !key) return null;
            const row = getReadConnection(dbPath, tableName, keyColumn)?.read.get(key);
            if (!row) return null;
            return (await zstdDecompress(row.turinys)).toString("utf8");
        },

        /**
         * Partija vienu query. Grąžina `Map<raktas, tekstas>` tik su rastais —
         * nerastų raktų map'e nėra.
         */
        async readManyRaw(keys) {
            const found = new Map();
            const dbPath = sidecarDbPath(sidecar);
            if (!dbPath || !keys?.length) return found;
            const connection = getReadConnection(dbPath, tableName, keyColumn);
            if (!connection) return found;

            const rows = connection.readMany.all(JSON.stringify(keys));
            const texts = await Promise.all(
                rows.map((row) => zstdDecompress(row.turinys)),
            );
            for (const [index, row] of rows.entries()) {
                found.set(row.raktas, texts[index].toString("utf8"));
            }
            return found;
        },

        exists(key) {
            const dbPath = sidecarDbPath(sidecar);
            if (!dbPath || !key) return false;
            return Boolean(getReadConnection(dbPath, tableName, keyColumn)?.read.get(key));
        },

        async saveRaw(key, contents) {
            const dbPath = sidecarDbPath(sidecar);
            if (!dbPath) {
                throw new Error(`SIDECAR_DIR nenustatytas, negalima išsaugoti (${key})`);
            }
            const raw = Buffer.from(contents, "utf8");
            const compressed = await zstdCompress(raw, ZSTD_OPTIONS);
            await enqueueWrite(getWriteConnection(dbPath, tableName, keyColumn), {
                key,
                rawBytes: raw.byteLength,
                compressed,
            });
        },
    };
}
