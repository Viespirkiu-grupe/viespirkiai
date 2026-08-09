import path from "node:path";
import { createHash } from "node:crypto";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";
import config from "../../utils/config.js";
import { closeSqlite, inTransaction, openSqlite } from "../../utils/sqlite.js";

// e-TAR API atsakymų sidecar saugykla.
//
// Postgres'e (eTar* lentelėse) laikom tik tai, ką galima normalizuoti. Pilnas
// atsakymas — su `official_text.html/markdown/text/structure`, `structure`
// medžiu ir žaliais laukais — yra didelis ir daugiausia tekstas, tad guli čia:
// viena SQLite lentelė, turinys suspaustas zstd, raktas — md5 nuo įrašomo JSON.
//
// Kodėl SQLite, o ne failų medis (kaip utils/sidecarStore.js): milijonas aktų ×
// kelios redakcijos = milijonai mažų failų, o tai flash'ui skaudu. WAL režimas →
// daug lygiagrečių skaitytojų iš skirtingų procesų, vienas rašytojas.

export const ETAR_SIDECAR_DIR = "/flashas/viespirkiai/eTar";
export const ETAR_SIDECAR_FILE = "eTar.sqlite";

/** Katalogas iš konfigūracijos (ETAR_SIDECAR_DIR), su numatytuoju atsarginiu. */
export function getETarSidecarDir() {
    return config.eTarSidecarDir || ETAR_SIDECAR_DIR;
}

// Nesaugom nei audito (`http_requests`), nei laiko žymos (`fetched_at` — jis jau
// yra Postgres'e), nei žalio HTML (`raw_page_html` — didžiausia atsakymo dalis ir
// atkuriamas iš šaltinio). Svarbu: šitie laukai išmetami PRIEŠ skaičiuojant md5,
// todėl nepasikeitęs aktas antrą kartą duoda tą patį md5 ir eilutė nedubliuojama.
export const VOLATILE_FIELDS = ["http_requests", "fetched_at", "raw_page_html"];

export function getETarSidecarPath(dir = getETarSidecarDir()) {
    return path.join(dir, ETAR_SIDECAR_FILE);
}

/**
 * Atidaro (jei reikia – sukuria) e-TAR sidecar bazę.
 * @param {Object} [opts]
 * @param {string} [opts.dbPath] - pilnas kelias iki .sqlite failo
 * @param {boolean} [opts.readonly] - skaitytojams (keli procesai lygiagrečiai)
 * @returns {import("node:sqlite").DatabaseSync}
 */
export function openETarSidecar({ dbPath = getETarSidecarPath(), readonly = false } = {}) {
    return openSqlite({ dbPath, readonly, ensureSchema: ensureETarSidecarSchema });
}

export { closeSqlite };

export function ensureETarSidecarSchema(db) {
    // md5 = hex nuo `turinys` prieš suspaudimą; jis pat guli Postgres'e
    // ("eTarLegalActDocument"."md5", "eTarEditionList"."md5").
    // dydis – originalaus JSON baitai, suspaustas – blob'o baitai (statistikai).
    db.exec(`
        CREATE TABLE IF NOT EXISTS "eTarAtsakymai" (
            "md5"        TEXT PRIMARY KEY,
            "dydis"      INTEGER NOT NULL,
            "suspaustas" INTEGER NOT NULL,
            "turinys"    BLOB NOT NULL
        ) STRICT
    `);
}

/** Naujas objektas be nepastovių laukų; originalo neliečiam. */
export function stripVolatileFields(response) {
    const copy = { ...response };
    for (const field of VOLATILE_FIELDS) delete copy[field];
    return copy;
}

/**
 * Serializuoja vieną kartą, kad md5 ir įrašomi baitai sutaptų tiksliai.
 * @returns {{ md5: string, json: string, turinys: Buffer, dydis: number }}
 */
export function prepareResponse(response) {
    const json = JSON.stringify(stripVolatileFields(response));
    return {
        md5: createHash("md5").update(json).digest("hex"),
        json,
        turinys: zstdCompressSync(Buffer.from(json, "utf8")),
        dydis: Buffer.byteLength(json),
    };
}

/**
 * Įrašo atsakymą ir grąžina jo md5. Tas pats turinys → tas pats raktas → no-op.
 * @returns {string} md5
 */
export function saveResponse(db, response) {
    const prepared = prepareResponse(response);
    writeRows(db, [prepared]);
    return prepared.md5;
}

/** Paketinis rašymas — vienoj tranzakcijoj, kitaip kiekvienas INSERT yra fsync'as. */
export function writeRows(db, rows) {
    if (!rows.length) return;
    const stmt = db.prepare(
        `INSERT INTO "eTarAtsakymai" ("md5", "dydis", "suspaustas", "turinys")
         VALUES (?, ?, ?, ?)
         ON CONFLICT("md5") DO NOTHING`,
    );
    inTransaction(db, () => {
        for (const row of rows) {
            stmt.run(row.md5, row.dydis, row.turinys.byteLength, row.turinys);
        }
    });
}

/** @returns {Object|null} atsakymas be nepastovių laukų */
export function readResponse(db, md5) {
    if (!md5) return null;
    const row = db.prepare(`SELECT "turinys" FROM "eTarAtsakymai" WHERE "md5" = ?`).get(md5);
    if (!row) return null;
    return JSON.parse(zstdDecompressSync(row.turinys).toString("utf8"));
}

export function hasResponse(db, md5) {
    if (!md5) return false;
    return db.prepare(`SELECT 1 FROM "eTarAtsakymai" WHERE "md5" = ?`).get(md5) != null;
}

export function getETarSidecarStats(db) {
    const row = db
        .prepare(`SELECT COUNT(*) c, SUM("dydis") raw, SUM("suspaustas") zstd FROM "eTarAtsakymai"`)
        .get();
    return {
        count: Number(row.c),
        rawBytes: Number(row.raw ?? 0),
        zstdBytes: Number(row.zstd ?? 0),
    };
}
