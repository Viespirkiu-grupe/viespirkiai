import { closeSqlite, inTransaction, openSqlite, removeSqlite } from "../../utils/sqlite.js";
import { getBendriNustatymai } from "./s3backupEnv.js";

/*
S3 backup būsena atskiroje SQLite bazėje.

Kodėl ne Postgres: 3,8 mln. eilučių statusų atnaujinimai neturi maišytis su
gyva DB, o backup įrankis turi veikti ir tada, kai Postgres perkraunamas.

Crash-safety esmė: `eile` NETURI jokio „claim"/lock stulpelio. Įrašas į `ikelti`
atsiranda tik po to, kai S3 patvirtino įkėlimą. Todėl po bet kokio crash'o
nereikia nieko atrakinti — neužfiksuotas md5 tiesiog paimamas iš naujo, o
pakartotinis įkėlimas idempotentiškas (raktas = turinio md5).

Dėl to pat naudojam `synchronous = NORMAL` (ne `OFF`, kaip utils/sqlite.js
default'as rašant): WAL + NORMAL apsaugo nuo proceso crash'o beveik nemokamai,
o pamesti valandų darbo apskaitą čia būtų brangu.
*/

export { closeSqlite, removeSqlite };

export function getS3backupSqlitePath() {
    return getBendriNustatymai().sqlitePath;
}

export function ensureS3backupSchema(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS "eile" (
            "md5"      TEXT PRIMARY KEY,
            "md5Id"    INTEGER NOT NULL,
            "dydis"    INTEGER NOT NULL,
            "pridetas" INTEGER NOT NULL
        ) STRICT
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS "ikelti" (
            "md5"     TEXT NOT NULL,
            "mazgas"  TEXT NOT NULL,
            "bucket"  TEXT NOT NULL,
            "raktas"  TEXT NOT NULL,
            "dydis"   INTEGER NOT NULL,
            "etag"    TEXT,
            "ikeltas" INTEGER NOT NULL,
            PRIMARY KEY ("md5", "mazgas")
        ) STRICT
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS "klaidos" (
            "md5"       TEXT NOT NULL,
            "mazgas"    TEXT NOT NULL,
            "bandymai"  INTEGER NOT NULL DEFAULT 0,
            "paskutine" TEXT,
            "kada"      INTEGER NOT NULL,
            PRIMARY KEY ("md5", "mazgas")
        ) STRICT
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS "bukle" (
            "raktas"  TEXT PRIMARY KEY,
            "reiksme" TEXT
        ) STRICT
    `);

    // Statistikai „kiek įkelta per parą" ir progreso ETA.
    db.exec(`CREATE INDEX IF NOT EXISTS "ikelti_ikeltas_idx" ON "ikelti" ("mazgas", "ikeltas")`);
}

/**
 * @param {Object} [opts]
 * @param {string} [opts.dbPath]
 * @param {boolean} [opts.readonly]
 * @returns {import("node:sqlite").DatabaseSync}
 */
export function openS3backupSqlite({ dbPath = getS3backupSqlitePath(), readonly = false } = {}) {
    const db = openSqlite({ dbPath, readonly, ensureSchema: ensureS3backupSchema });
    // utils/sqlite.js rašant nustato synchronous = OFF (jo bazės atkuriamos iš
    // šaltinio). Čia atvirkščiai — apskaitos pamesti negalima, o WAL + NORMAL
    // apsaugo nuo proceso crash'o beveik nemokamai.
    if (!readonly) db.exec("PRAGMA synchronous = NORMAL");
    return db;
}

/* ------------------------------- eilė ------------------------------- */

/** Batch'inis eilės rašytojas — vienas `inTransaction` visai porcijai. */
export function createEileWriter(db) {
    const stmt = db.prepare(
        `INSERT INTO "eile" ("md5", "md5Id", "dydis", "pridetas")
         VALUES (?, ?, ?, ?)
         ON CONFLICT("md5") DO NOTHING`,
    );

    return {
        /**
         * @param {{md5: string, md5Id: number, dydis: number}[]} rows
         * @returns {number} kiek naujų eilučių pridėta
         */
        insertMany(rows) {
            const now = Date.now();
            return inTransaction(db, () => {
                let prideta = 0;
                for (const row of rows) {
                    prideta += stmt.run(row.md5, row.md5Id, row.dydis, now).changes;
                }
                return prideta;
            });
        },
    };
}

export function getQueueCursor(db) {
    const row = db.prepare(`SELECT "reiksme" FROM "bukle" WHERE "raktas" = 'queueCursor'`).get();
    return row?.reiksme == null ? null : Number(row.reiksme);
}

export function setQueueCursor(db, md5Id) {
    db.prepare(
        `INSERT INTO "bukle" ("raktas", "reiksme") VALUES ('queueCursor', ?)
         ON CONFLICT("raktas") DO UPDATE SET "reiksme" = excluded."reiksme"`,
    ).run(String(md5Id));
}

/* ------------------------------ įkėlimas ------------------------------ */

/**
 * Kita porcija dar neįkeltų md5 pasirinktam mazgui, keyset pagal `md5`.
 * Praleidžia tuos, kurie jau pasiekė `maxBandymu` klaidų — kad nesikartotų
 * amžinai; juos galima pakartoti su `--valyti-klaidas`.
 *
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {Object} p
 * @param {string} p.mazgas
 * @param {number} p.maxBandymu
 * @param {string|null} p.poMd5 - keyset kursorius (null = nuo pradžių)
 * @param {number} p.limit
 * @returns {{md5: string, dydis: number}[]}
 */
export function imtiNeikeltus(db, { mazgas, maxBandymu, poMd5, limit }) {
    return db
        .prepare(
            `SELECT e."md5" AS md5, e."dydis" AS dydis
             FROM "eile" e
             LEFT JOIN "ikelti"  i ON i."md5" = e."md5" AND i."mazgas" = ?
             LEFT JOIN "klaidos" k ON k."md5" = e."md5" AND k."mazgas" = ?
             WHERE i."md5" IS NULL
               AND COALESCE(k."bandymai", 0) < ?
               AND (? IS NULL OR e."md5" > ?)
             ORDER BY e."md5"
             LIMIT ?`,
        )
        .all(mazgas, mazgas, maxBandymu, poMd5, poMd5, limit)
        .map((row) => ({ md5: row.md5, dydis: Number(row.dydis) }));
}

/**
 * Batch'inis rezultatų rašytojas. Sėkmė ir klaida rašomos ta pačia transakcija,
 * kad SQLite nebūtų kliūtis prie didelio concurrency.
 */
export function createRezultatuWriter(db, mazgas) {
    const ikeltiStmt = db.prepare(
        `INSERT INTO "ikelti" ("md5", "mazgas", "bucket", "raktas", "dydis", "etag", "ikeltas")
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT("md5", "mazgas") DO UPDATE SET
             "bucket"  = excluded."bucket",
             "raktas"  = excluded."raktas",
             "dydis"   = excluded."dydis",
             "etag"    = excluded."etag",
             "ikeltas" = excluded."ikeltas"`,
    );
    const trintiKlaidaStmt = db.prepare(
        `DELETE FROM "klaidos" WHERE "md5" = ? AND "mazgas" = ?`,
    );
    const klaidaStmt = db.prepare(
        `INSERT INTO "klaidos" ("md5", "mazgas", "bandymai", "paskutine", "kada")
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT("md5", "mazgas") DO UPDATE SET
             "bandymai"  = "klaidos"."bandymai" + 1,
             "paskutine" = excluded."paskutine",
             "kada"      = excluded."kada"`,
    );

    return {
        /**
         * @param {{md5: string, bucket: string, raktas: string, dydis: number, etag: string|null}[]} sekmes
         * @param {{md5: string, klaida: string}[]} klaidos
         */
        flush(sekmes, klaidos) {
            if (!sekmes.length && !klaidos.length) return;
            const now = Date.now();
            inTransaction(db, () => {
                for (const s of sekmes) {
                    ikeltiStmt.run(s.md5, mazgas, s.bucket, s.raktas, s.dydis, s.etag, now);
                    trintiKlaidaStmt.run(s.md5, mazgas);
                }
                for (const k of klaidos) {
                    klaidaStmt.run(k.md5, mazgas, k.klaida.slice(0, 500), now);
                }
            });
        },
    };
}

/** Ištrina klaidų žymes — kad `--valyti-klaidas` leistų pakartoti pasidavusius. */
export function valytiKlaidas(db, mazgas) {
    return db.prepare(`DELETE FROM "klaidos" WHERE "mazgas" = ?`).run(mazgas).changes;
}

/* ------------------------------ statistika ------------------------------ */

/**
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {string} mazgas
 */
export function getStats(db, mazgas) {
    const eile = db.prepare(`SELECT COUNT(*) c, COALESCE(SUM("dydis"), 0) b FROM "eile"`).get();
    const ikelta = db
        .prepare(
            `SELECT COUNT(*) c, COALESCE(SUM("dydis"), 0) b FROM "ikelti" WHERE "mazgas" = ?`,
        )
        .get(mazgas);
    const klaidos = db
        .prepare(
            `SELECT COUNT(*) c, COALESCE(SUM("bandymai"), 0) b FROM "klaidos" WHERE "mazgas" = ?`,
        )
        .get(mazgas);

    // Kiek liko: eilės įrašai be `ikelti` eilutės šiam mazgui.
    const liko = db
        .prepare(
            `SELECT COUNT(*) c, COALESCE(SUM(e."dydis"), 0) b
             FROM "eile" e
             LEFT JOIN "ikelti" i ON i."md5" = e."md5" AND i."mazgas" = ?
             WHERE i."md5" IS NULL`,
        )
        .get(mazgas);

    return {
        eileCount: Number(eile.c),
        eileBytes: Number(eile.b),
        ikeltaCount: Number(ikelta.c),
        ikeltaBytes: Number(ikelta.b),
        klaiduCount: Number(klaidos.c),
        klaiduBandymai: Number(klaidos.b),
        likoCount: Number(liko.c),
        likoBytes: Number(liko.b),
    };
}

/** Įkėlimo tempas per paskutines `valandos` valandas — realiam ETA. */
export function getTempas(db, mazgas, valandos = 24) {
    const nuo = Date.now() - valandos * 3600_000;
    const row = db
        .prepare(
            `SELECT COUNT(*) c, COALESCE(SUM("dydis"), 0) b, MIN("ikeltas") nuo
             FROM "ikelti" WHERE "mazgas" = ? AND "ikeltas" >= ?`,
        )
        .get(mazgas, nuo);
    const pradzia = row.nuo == null ? null : Number(row.nuo);
    const trukmeS = pradzia ? Math.max(1, (Date.now() - pradzia) / 1000) : 0;
    return {
        count: Number(row.c),
        bytes: Number(row.b),
        failaiPerS: trukmeS ? Number(row.c) / trukmeS : 0,
        baitaiPerS: trukmeS ? Number(row.b) / trukmeS : 0,
    };
}

/** Paskutiniai įkelti objektai — greitas „ar tikrai juda" patikrinimas. */
export function getPaskutinius(db, mazgas, limit = 5) {
    return db
        .prepare(
            `SELECT "md5", "bucket", "raktas", "dydis", "etag", "ikeltas"
             FROM "ikelti" WHERE "mazgas" = ?
             ORDER BY "ikeltas" DESC LIMIT ?`,
        )
        .all(mazgas, limit)
        .map((row) => ({
            md5: row.md5,
            bucket: row.bucket,
            raktas: row.raktas,
            dydis: Number(row.dydis),
            etag: row.etag,
            ikeltas: Number(row.ikeltas),
        }));
}

/** Dažniausios klaidos — kad matytųsi, ar tai 404, timeout ar md5 nesutapimai. */
export function getKlaiduSuvestine(db, mazgas, limit = 20) {
    return db
        .prepare(
            `SELECT "paskutine" AS klaida, COUNT(*) AS kiek
             FROM "klaidos" WHERE "mazgas" = ?
             GROUP BY "paskutine" ORDER BY kiek DESC LIMIT ?`,
        )
        .all(mazgas, limit)
        .map((row) => ({ klaida: row.klaida, kiek: Number(row.kiek) }));
}
