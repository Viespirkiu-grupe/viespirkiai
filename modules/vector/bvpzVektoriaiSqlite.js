import path from "node:path";
import { closeSqlite, inTransaction, openSqlite } from "../../utils/sqlite.js";

export const BVPZ_VEKTORIAI_SQLITE_DIR = "/flashas/viespirkiai/bvpzVektoriai";
export const BVPZ_VEKTORIAI_SQLITE_FILE = "bvpzVektoriai.sqlite";

export function getBvpzVektoriaiSqlitePath(dir = BVPZ_VEKTORIAI_SQLITE_DIR) {
    return path.join(dir, BVPZ_VEKTORIAI_SQLITE_FILE);
}

export function openBvpzVektoriaiSqlite({ dbPath = getBvpzVektoriaiSqlitePath(), readonly = false } = {}) {
    return openSqlite({ dbPath, readonly, ensureSchema: ensureBvpzVektoriaiSchema });
}

export { closeSqlite };

export function ensureBvpzVektoriaiSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS "bvpz" (
            "mask"        TEXT PRIMARY KEY,
            "code"        TEXT NOT NULL UNIQUE,
            "checksum"    TEXT NOT NULL,
            "pavadinimas" TEXT NOT NULL,
            "vektorius"   BLOB
        ) STRICT, WITHOUT ROWID;

        CREATE TABLE IF NOT EXISTS "meta" (
            "key"   TEXT PRIMARY KEY,
            "value" TEXT NOT NULL
        ) STRICT, WITHOUT ROWID;
    `);
}

export function getMeta(db, key) {
    return db.prepare(`SELECT "value" FROM "meta" WHERE "key" = ?`).get(key)?.value ?? null;
}

export function setMeta(db, key, value) {
    db.prepare(
        `INSERT INTO "meta" ("key", "value") VALUES (?, ?)
         ON CONFLICT("key") DO UPDATE SET "value" = excluded."value"`,
    ).run(key, String(value));
}

/**
 * Sinchronizuoja PostgreSQL žodyną. Nepasikeitusių pavadinimų vektoriai lieka,
 * pakeistų – nunulinami; iš PostgreSQL pašalinti kodai pašalinami ir iš SQLite.
 */
export function syncBvpzRows(db, rows) {
    db.exec(`CREATE TEMP TABLE IF NOT EXISTS "_bvpz_seen" ("mask" TEXT PRIMARY KEY) WITHOUT ROWID`);
    const upsert = db.prepare(`
        INSERT INTO "bvpz" ("mask", "code", "checksum", "pavadinimas")
        VALUES (?, ?, ?, ?)
        ON CONFLICT("mask") DO UPDATE SET
            "code" = excluded."code",
            "checksum" = excluded."checksum",
            "pavadinimas" = excluded."pavadinimas",
            "vektorius" = CASE
                WHEN "bvpz"."pavadinimas" = excluded."pavadinimas" THEN "bvpz"."vektorius"
                ELSE NULL
            END
    `);
    const seen = db.prepare(`INSERT INTO "_bvpz_seen" ("mask") VALUES (?)`);

    inTransaction(db, () => {
        db.exec(`DELETE FROM "_bvpz_seen"`);
        for (const row of rows) {
            upsert.run(row.mask, row.code, row.checksum ?? "", row.pavadinimas);
            seen.run(row.mask);
        }
        db.exec(`DELETE FROM "bvpz" WHERE "mask" NOT IN (SELECT "mask" FROM "_bvpz_seen")`);
    });
}

export function prepareModel(db, model) {
    const previous = getMeta(db, "model");
    if (previous !== null && previous !== model) {
        inTransaction(db, () => {
            db.exec(`UPDATE "bvpz" SET "vektorius" = NULL`);
            setMeta(db, "model", model);
            db.prepare(`DELETE FROM "meta" WHERE "key" = 'dim'`).run();
        });
        return { previous, reset: true };
    }
    setMeta(db, "model", model);
    return { previous, reset: false };
}

export function getBvpzCounts(db) {
    const row = db.prepare(`
        SELECT COUNT(*) AS "visi",
               COUNT("vektorius") AS "suVektorium"
        FROM "bvpz"
    `).get();
    return { visi: Number(row.visi), suVektorium: Number(row.suVektorium) };
}

export function createBvpzBeVektoriausReader(db, { batch = 50, limit = Infinity } = {}) {
    const stmt = db.prepare(`
        SELECT "mask", "pavadinimas" FROM "bvpz"
        WHERE "vektorius" IS NULL AND (?1 IS NULL OR "mask" > ?1)
        ORDER BY "mask" LIMIT ?2
    `);
    let cursor = null;
    let taken = 0;
    return () => {
        const size = Math.min(batch, limit - taken);
        if (size <= 0) return null;
        const rows = stmt.all(cursor, size);
        if (rows.length === 0) return null;
        cursor = rows.at(-1).mask;
        taken += rows.length;
        return rows;
    };
}

export function createBvpzVektoriuWriter(db) {
    const stmt = db.prepare(`UPDATE "bvpz" SET "vektorius" = ? WHERE "mask" = ?`);
    return {
        updateMany(rows) {
            inTransaction(db, () => {
                for (const row of rows) stmt.run(row.blob, row.mask);
            });
        },
    };
}

export function getBvpzSuVektoriais(db) {
    return db.prepare(`
        SELECT "mask", "code", "checksum", "pavadinimas", "vektorius"
        FROM "bvpz" WHERE "vektorius" IS NOT NULL ORDER BY "code"
    `).all();
}
