import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { postgres } from "../../postgres/postgres.js";
import { limitArg, numArg, parseArgs } from "../../utils/cliArgs.js";
import { openSqlite } from "../../utils/sqlite.js";
import { quoteIdentifier } from "../../utils/sqliteSidecarStore.js";
import { sidecarDbPath, sidecarKeyColumn, sidecarTable } from "../../utils/sidecarPaths.js";

// Kelias, lentelė ir rakto stulpelis imami iš bendro registro
// (`utils/sidecarPaths.js`) — čia lieka tik tai, ko registras nežino: iš kur
// Postgres'e paimti referencinius hash'us.
const SIDECAR_SALTINIAI = {
    failaiInfo: {
        fromSql: `FROM public."filesInfoFiles" WHERE "fileHash" IS NOT NULL`,
        keySql: `"fileHash"`,
    },
    dokumentai: {
        // Sidecar saugyklos vardas lieka „dokumentai"; md5 dabar gali ateiti ir
        // iš dokumento eilutės, ir iš failo, tad imam jį iš vaizdo.
        fromSql: `FROM documents."documentsFull" WHERE md5 IS NOT NULL`,
        keySql: `md5`,
    },
    ocrRezultatai: {
        fromSql: `FROM public."filesOcrStatus" WHERE "resultHash" IS NOT NULL`,
        keySql: `"resultHash"`,
    },
    liteko2: {
        fromSql: `FROM public."liteko2Sprendimai" WHERE md5 IS NOT NULL`,
        keySql: `md5`,
    },
    eTar: {
        // Aktų dokumentai ir redakcijų sąrašai rašo į tą pačią sidecar lentelę,
        // tad referencinė aibė yra jų md5 sąjunga.
        fromSql: `FROM (
                      SELECT md5 FROM "eTar"."legalActDocument"
                      UNION
                      SELECT md5 FROM "eTar"."editionList"
                  ) t WHERE md5 IS NOT NULL`,
        keySql: `md5`,
    },
};

/** Grąžina tuos batch'o hash'us, kurių nėra SQLite. */
export function missingFromBatch(db, tableName, hashes, keyColumn = "hash") {
    if (!hashes.length) return [];
    const table = quoteIdentifier(tableName);
    const key = quoteIdentifier(keyColumn);
    // json_each leidžia vienu indexed query patikrinti visą batch'ą ir neatsiremti
    // į SQLite bind parametrų limitą. JSON masyve hash'ai lieka paprastos reikšmės.
    const rows = db.prepare(
        `SELECT ${key} AS "raktas" FROM ${table}
         WHERE ${key} IN (SELECT value FROM json_each(?))`,
    ).all(JSON.stringify(hashes));
    const found = new Set(rows.map((row) => row.raktas));
    return hashes.filter((hash) => !found.has(hash));
}

export async function runSqliteMissingAudit({ argv = process.argv.slice(2) } = {}) {
    const args = parseArgs(argv);
    const storeName = args.store;
    const definition = SIDECAR_SALTINIAI[storeName];
    if (!definition) {
        throw new Error(`--store turi būti vienas iš: ${Object.keys(SIDECAR_SALTINIAI).join(", ")}`);
    }

    const pageSize = numArg(args.page, 50000);
    const limit = limitArg(args.limit);
    const dbPath = typeof args.db === "string" ? args.db : sidecarDbPath(storeName);
    if (!dbPath) throw new Error("SIDECAR_DIR nenustatytas (arba naudokite --db)");
    if (!fs.existsSync(dbPath)) throw new Error(`SQLite failas nerastas: ${dbPath}`);

    const table = sidecarTable(storeName);
    const keyColumn = sidecarKeyColumn(storeName);
    const db = openSqlite({ dbPath, readonly: true });

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
            const absent = missingFromBatch(db, table, hashes, keyColumn);
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
