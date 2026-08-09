import { promisify } from "node:util";
import zlib from "node:zlib";
import fs from "node:fs";
import config from "./config.js";
import { inTransaction, openSqlite } from "./sqlite.js";

const zstdCompress = promisify(zlib.zstdCompress);
const zstdDecompress = promisify(zlib.zstdDecompress);
const ZSTD_OPTIONS = {
    params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 },
};

// Vienas ryšys konkrečiam DB failui ir lentelei viename procese. Kiti procesai
// turi savo ryšius; WAL ir busy_timeout suderina jų skaitymus bei rašymus.
const connections = new Map();

function quoteIdentifier(value) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
        throw new Error(`Blogas SQLite identifikatorius: ${value}`);
    }
    return `"${value}"`;
}

export function ensureCompressedSidecarSchema(db, tableName) {
    const table = quoteIdentifier(tableName);
    db.exec(`
        CREATE TABLE IF NOT EXISTS ${table} (
            "hash" TEXT PRIMARY KEY,
            "dydis" INTEGER NOT NULL,
            "suspaustas" INTEGER NOT NULL,
            "turinys" BLOB NOT NULL
        ) STRICT
    `);
}

function getWriteConnection(dbPath, tableName) {
    const key = `write\0${dbPath}\0${tableName}`;
    let cached = connections.get(key);
    if (cached) return cached;

    const table = quoteIdentifier(tableName);
    const db = openSqlite({
        dbPath,
        synchronous: "FULL",
        ensureSchema: (opened) => ensureCompressedSidecarSchema(opened, tableName),
    });
    cached = {
        db,
        read: db.prepare(`SELECT "turinys" FROM ${table} WHERE "hash" = ?`),
        upsert: db.prepare(
            `INSERT INTO ${table} ("hash", "dydis", "suspaustas", "turinys")
             VALUES (?, ?, ?, ?)
             ON CONFLICT("hash") DO UPDATE SET
                 "dydis" = excluded."dydis",
                 "suspaustas" = excluded."suspaustas",
                 "turinys" = excluded."turinys"`,
        ),
        writable: true,
        pending: [],
        flushScheduled: false,
    };
    connections.set(key, cached);
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

function getReadConnection(dbPath, tableName) {
    const write = connections.get(`write\0${dbPath}\0${tableName}`);
    if (write) return write;
    if (!fs.existsSync(dbPath)) return null;

    const key = `read\0${dbPath}\0${tableName}`;
    let cached = connections.get(key);
    if (cached) return cached;
    const table = quoteIdentifier(tableName);
    const db = openSqlite({ dbPath, readonly: true });
    cached = {
        db,
        read: db.prepare(`SELECT "turinys" FROM ${table} WHERE "hash" = ?`),
        writable: false,
    };
    connections.set(key, cached);
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

/** Zstd SQLite saugykla; `locationKey` reikšmė yra pilnas .sqlite kelias. */
export function createCompressedSqliteStore({ locationKey, tableName }) {
    return {
        configured() {
            return Boolean(config[locationKey]);
        },

        async readRaw(key) {
            const dbPath = config[locationKey];
            if (!dbPath || !key) return null;
            const row = getReadConnection(dbPath, tableName)?.read.get(key);
            if (!row) return null;
            return (await zstdDecompress(row.turinys)).toString("utf8");
        },

        exists(key) {
            const dbPath = config[locationKey];
            if (!dbPath || !key) return false;
            return Boolean(getReadConnection(dbPath, tableName)?.read.get(key));
        },

        async saveRaw(key, contents) {
            const dbPath = config[locationKey];
            if (!dbPath) {
                throw new Error(`${locationKey} nenustatytas, negalima išsaugoti (${key})`);
            }
            const raw = Buffer.from(contents, "utf8");
            const compressed = await zstdCompress(raw, ZSTD_OPTIONS);
            await enqueueWrite(getWriteConnection(dbPath, tableName), {
                key,
                rawBytes: raw.byteLength,
                compressed,
            });
        },
    };
}
