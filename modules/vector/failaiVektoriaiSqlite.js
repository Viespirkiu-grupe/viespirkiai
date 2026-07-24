import path from "node:path";
import { closeSqlite, inTransaction, openSqlite } from "../../utils/sqlite.js";

// cvpIs failų teksto vektorizavimo queue. Tekstas suskaidytas į bge-m3 langus
// (prev256 + core1024 + next256), dedupintas pagal md5(tekstas) → vienas hash =
// viena tiksli modelio įvestis = vienas vektorius. Atskira "saltiniai" lentelė
// laiko many-to-many ryšį (tas pats tekstas kartojasi daug pirkimų), kad paieškoms
// nereikėtų eiti per milijonus Postgres failų. Vektoriai (BLOB) užpildomi vėliau.
// WAL → daug lygiagrečių skaitytojų, vienas rašytojas (kaip visada SQLite).

export const FAILAI_VEKTORIAI_SQLITE_DIR = "/flashas/viespirkiai/failaiVektoriai";
export const FAILAI_VEKTORIAI_SQLITE_FILE = "failaiVektoriai.sqlite";

export function getFailaiVektoriaiSqlitePath(dir = FAILAI_VEKTORIAI_SQLITE_DIR) {
    return path.join(dir, FAILAI_VEKTORIAI_SQLITE_FILE);
}

/**
 * Atidaro (jei reikia – sukuria) failaiVektoriai SQLite bazę.
 * @param {Object} [opts]
 * @param {string} [opts.dbPath] - pilnas kelias iki .sqlite failo
 * @param {boolean} [opts.readonly] - skaitytojams (keli procesai lygiagrečiai)
 * @returns {import("node:sqlite").DatabaseSync}
 */
export function openFailaiVektoriaiSqlite({ dbPath = getFailaiVektoriaiSqlitePath(), readonly = false } = {}) {
    return openSqlite({ dbPath, readonly, ensureSchema: ensureFailaiVektoriaiSchema });
}

export { closeSqlite };

export function ensureFailaiVektoriaiSchema(db) {
    db.exec(`
        -- Dedupinti teksto langai — tai, ką realiai embeddins bge-m3.
        CREATE TABLE IF NOT EXISTS "gabalai" (
            "hash"      TEXT PRIMARY KEY,   -- md5(tekstas)
            "tekstas"   TEXT NOT NULL,      -- prev256 + core1024 + next256 (decode'inti tokenai)
            "tokenai"   INTEGER NOT NULL,   -- lango tokenų skaičius (≤ 1536)
            "vektorius" BLOB                -- NULL kol nevektorizuota; float32[1024] LE = 4096 B
        ) STRICT;

        -- Kas iš ko (many-to-many): vienas hash gali būti daug pirkimų/failų.
        CREATE TABLE IF NOT EXISTS "saltiniai" (
            "failaiId"                INTEGER NOT NULL,  -- failai.id (atsekamumui)
            "eile"                    INTEGER NOT NULL,  -- core dalies indeksas faile (0..)
            "hash"                    TEXT NOT NULL,     -- → gabalai.hash
            "pirkimoId"               INTEGER,
            "pirkimoFailoId"          INTEGER,
            "pirkimoFailoVersijosId"  INTEGER,
            PRIMARY KEY ("failaiId", "eile")
        ) STRICT, WITHOUT ROWID;

        CREATE INDEX IF NOT EXISTS "saltiniai_hash_idx" ON "saltiniai"("hash");

        -- Progresas / resume: kurie failai jau sudėti.
        CREATE TABLE IF NOT EXISTS "apdoroti" (
            "failaiId" INTEGER PRIMARY KEY
        ) STRICT, WITHOUT ROWID;
    `);
}

/**
 * Paskutinis apdorotas failai.id – tęsimui (keyset paginacija per failai.id).
 */
export function getLastFailaiId(db) {
    const row = db.prepare(`SELECT MAX("failaiId") AS id FROM "apdoroti"`).get();
    return row?.id ?? null;
}

// COUNT(*) SQLite optimizuoja (Count opcode), o COUNT(1) apeina visas eilutes.
export function getGabaluCount(db) {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM "gabalai"`).get().c);
}

export function getSaltiniuCount(db) {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM "saltiniai"`).get().c);
}

export function getApdorotuCount(db) {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM "apdoroti"`).get().c);
}

export function getBeVektoriausCount(db) {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM "gabalai" WHERE "vektorius" IS NULL`).get().c);
}

export function getSuVektoriumCount(db) {
    return Number(db.prepare(`SELECT COUNT(*) AS c FROM "gabalai" WHERE "vektorius" IS NOT NULL`).get().c);
}

/** Vieno gabalo šaltiniai (kur tas pats tekstas pasitaikė). */
export function getGabaloSaltiniai(db, hash) {
    return db
        .prepare(
            `SELECT "failaiId", "eile", "pirkimoId", "pirkimoFailoId", "pirkimoFailoVersijosId"
             FROM "saltiniai" WHERE "hash" = ? ORDER BY "failaiId", "eile"`,
        )
        .all(hash);
}

/**
 * Paruošia paketinį rašytoją queue pildymui. Rašom vienoj tranzakcijoj – kitaip
 * kiekvienas INSERT yra atskiras fsync'as ir viskas miršta.
 */
export function createFailaiVektoriaiWriter(db) {
    const gabalasStmt = db.prepare(
        `INSERT INTO "gabalai" ("hash", "tekstas", "tokenai")
         VALUES (?, ?, ?)
         ON CONFLICT("hash") DO NOTHING`,
    );
    const saltinisStmt = db.prepare(
        `INSERT INTO "saltiniai"
             ("failaiId", "eile", "hash", "pirkimoId", "pirkimoFailoId", "pirkimoFailoVersijosId")
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT("failaiId", "eile") DO NOTHING`,
    );
    const apdorotasStmt = db.prepare(
        `INSERT INTO "apdoroti" ("failaiId") VALUES (?) ON CONFLICT("failaiId") DO NOTHING`,
    );

    return {
        /**
         * @param {{
         *   gabalai: {hash: string, tekstas: string, tokenai: number}[],
         *   saltiniai: {failaiId: number, eile: number, hash: string,
         *               pirkimoId: number|null, pirkimoFailoId: number|null,
         *               pirkimoFailoVersijosId: number|null}[],
         *   apdorotiFailaiId: number[],
         * }} batch
         */
        insertMany({ gabalai, saltiniai, apdorotiFailaiId }) {
            inTransaction(db, () => {
                for (const g of gabalai) {
                    gabalasStmt.run(g.hash, g.tekstas, g.tokenai);
                }
                for (const s of saltiniai) {
                    saltinisStmt.run(
                        s.failaiId,
                        s.eile,
                        s.hash,
                        s.pirkimoId,
                        s.pirkimoFailoId,
                        s.pirkimoFailoVersijosId,
                    );
                }
                for (const id of apdorotiFailaiId) {
                    apdorotasStmt.run(id);
                }
            });
        },
    };
}

/**
 * Neužpildytų gabalų skaitytuvas vektorizavimui. Keyset per hash (PK), kad
 * kiekviena eilutė per paleidimą būtų aplankyta kartą, o ne skenuota nuo pradžios
 * kiekvienam puslapiui. Skaitymas SINCHRONIŠKAS (be await) → keli lygiagretūs
 * darbininkai gali traukti be lenktynių.
 *
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {Object} [opts]
 * @param {number} [opts.batch] - kiek eilučių atiduoti per vieną kvietimą
 * @param {number} [opts.refill] - kiek eilučių paimti iš SQLite vienu skaitymu
 * @param {number} [opts.limit] - viso eilučių riba (testams)
 * @returns {() => {hash: string, tekstas: string}[]|null}
 */
export function createBeVektoriausReader(db, { batch = 25, refill = batch * 4, limit = Infinity } = {}) {
    const selectStmt = db.prepare(
        `SELECT "hash", "tekstas" FROM "gabalai"
         WHERE "vektorius" IS NULL AND (?1 IS NULL OR "hash" > ?1)
         ORDER BY "hash" LIMIT ?2`,
    );

    let cursor = null;
    let buffer = [];
    let bufPos = 0;
    let exhausted = false;
    let taken = 0;

    return function nextBatch() {
        // Papildom buffer'į jei liko mažai (sinchroniška, tad atomiška).
        if (!exhausted && buffer.length - bufPos < batch) {
            if (bufPos > 0) {
                buffer = buffer.slice(bufPos);
                bufPos = 0;
            }
            const rows = selectStmt.all(cursor, refill);
            if (rows.length === 0) {
                exhausted = true;
            } else {
                cursor = rows[rows.length - 1].hash;
                buffer.push(...rows);
                if (rows.length < refill) exhausted = true;
            }
        }
        const remaining = limit - taken;
        if (remaining <= 0 || bufPos >= buffer.length) return null;
        const size = Math.min(batch, buffer.length - bufPos, remaining);
        const slice = buffer.slice(bufPos, bufPos + size);
        bufPos += size;
        taken += size;
        return slice;
    };
}

/** Paketinis vektorių įrašymas (viena tranzakcija). */
export function createVektoriuWriter(db) {
    const updateStmt = db.prepare(`UPDATE "gabalai" SET "vektorius" = ? WHERE "hash" = ?`);
    return {
        /** @param {{hash: string, blob: Buffer}[]} rows */
        updateMany(rows) {
            inTransaction(db, () => {
                for (const row of rows) updateStmt.run(row.blob, row.hash);
            });
        },
    };
}
