import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { postgres } from "../../postgres/postgres.js";
import config from "../../utils/config.js";
import { limitArg, numArg, parseArgs } from "../../utils/cliArgs.js";

const SIDECAR_STORES = {
    failaiInfo: {
        table: "failaiInfo",
        sqliteConfigKey: "failaiInfoSqliteLocation",
        fromSql: `FROM public."filesInfoFiles" WHERE "fileHash" IS NOT NULL`,
        keySql: `"fileHash"`,
    },
    dokumentai: {
        table: "dokumentai",
        sqliteConfigKey: "dokumentaiSqliteLocation",
        fromSql: `FROM public.dokumentai WHERE md5 IS NOT NULL`,
        keySql: `md5`,
    },
    ocr: {
        table: "ocrRezultatai",
        sqliteConfigKey: "ocrRezultataiSqliteLocation",
        fromSql: `FROM public."filesOcrStatus" WHERE "resultHash" IS NOT NULL`,
        keySql: `"resultHash"`,
    },
};

function quoteIdentifier(value) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) throw new Error(`Bloga lentelė: ${value}`);
    return `"${value}"`;
}

/** Grąžina tuos batch'o hash'us, kurių nėra SQLite. */
export function missingFromBatch(db, tableName, hashes) {
    if (!hashes.length) return [];
    const table = quoteIdentifier(tableName);
    // json_each leidžia vienu indexed query patikrinti visą batch'ą ir neatsiremti
    // į SQLite bind parametrų limitą. JSON masyve hash'ai lieka paprastos reikšmės.
    const rows = db.prepare(
        `SELECT "hash" FROM ${table}
         WHERE "hash" IN (SELECT value FROM json_each(?))`,
    ).all(JSON.stringify(hashes));
    const found = new Set(rows.map((row) => row.hash));
    return hashes.filter((hash) => !found.has(hash));
}

export async function runSqliteMissingAudit({ argv = process.argv.slice(2) } = {}) {
    const args = parseArgs(argv);
    const storeName = args.store;
    const definition = SIDECAR_STORES[storeName];
    if (!definition) {
        throw new Error(`--store turi būti vienas iš: ${Object.keys(SIDECAR_STORES).join(", ")}`);
    }

    const pageSize = numArg(args.page, 50000);
    const limit = limitArg(args.limit);
    const dbPath = typeof args.db === "string" ? args.db : config[definition.sqliteConfigKey];
    if (!dbPath) throw new Error(`${definition.sqliteConfigKey} nenustatytas (arba naudokite --db)`);
    if (!fs.existsSync(dbPath)) throw new Error(`SQLite failas nerastas: ${dbPath}`);

    const db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec("PRAGMA busy_timeout = 15000");

    let cursor = typeof args.after === "string" ? args.after : null;
    let checked = 0;
    let missing = 0;
    const examples = [];
    const started = performance.now();

    try {
        while (checked < limit) {
            const { rows } = await postgres.query(
                `SELECT DISTINCT ${definition.keySql} AS hash
                 ${definition.fromSql}
                   AND ($1::text IS NULL OR ${definition.keySql} > $1)
                 ORDER BY ${definition.keySql}
                 LIMIT $2`,
                [cursor, Math.min(pageSize, limit - checked)],
            );
            if (!rows.length) break;

            const hashes = rows.map((row) => row.hash);
            const absent = missingFromBatch(db, definition.table, hashes);
            for (const hash of absent) {
                console.log(`TRŪKSTA ${hash}`);
                if (examples.length < 20) examples.push(hash);
            }

            checked += hashes.length;
            missing += absent.length;
            cursor = hashes[hashes.length - 1];
            const seconds = (performance.now() - started) / 1000;
            console.log(
                `${checked.toLocaleString()} patikrinta, ${missing.toLocaleString()} trūksta, ` +
                `${Math.round(checked / Math.max(seconds, 0.001)).toLocaleString()} hash/s, cursor ${cursor}`,
            );
        }
    } finally {
        db.close();
    }

    console.log(
        `Baigta: ${checked.toLocaleString()} patikrinta, ${missing.toLocaleString()} trūksta`,
    );
    return { checked, missing, cursor, examples };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    runSqliteMissingAudit()
        .then(() => postgres.end())
        .catch(async (error) => {
            console.error("SQLite trūkstamų sidecar'ų patikra nulūžo:", error);
            await postgres.end();
            process.exitCode = 1;
        });
}
