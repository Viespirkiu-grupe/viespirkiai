import fs from "node:fs";
import config from "../utils/config.js";
import pkg from "pg";
const { Pool, types } = pkg;

// DATE (OID 1082) → string
types.setTypeParser(1082, (str) => str);

// TIMESTAMP WITHOUT TIME ZONE (OID 1114) → string:
types.setTypeParser(1114, (str) => str);

// NUMERIC/DECIMAL (OID 1700) → float
types.setTypeParser(1700, (val) => parseFloat(val));

export const postgres = new Pool({
    host: config.pgHost,
    user: config.pgUser,
    password: config.pgPassword,
    database: config.pgDatabase,
    port: config.pgPort,
    max: config.pgMaxConnections, // max connections
    idleTimeoutMillis: 30000, // close idle clients after 30s
    connectionTimeoutMillis: 10_000, // fail if connection takes longer
    statement_cache_size: 0, // for pgbouncer
});

// Debuginimui: config.pgLogQueries įjungia visų per postgres.query() einančių
// užklausų logavimą su trukme; loginamos tik trukusios >= config.pgLogQueriesMinMs.
// Sąmoningai NEapgaubiam postgres.connect() paimtų klientų (streamai, tranzakcijos)
// – tik paprastą pool.query() promise formą; callback ir Submittable (pvz.
// QueryStream) formos praleidžiamos nepaliestos.
const PG_LOG_QUERIES = config.pgLogQueries === true;
const PG_LOG_QUERIES_MIN_MS = Number(config.pgLogQueriesMinMs) || 0;
// Neprivalomas failas – atidaromas kartą, rašoma append režimu.
const pgLogFileStream =
    PG_LOG_QUERIES && config.pgLogQueriesFile
        ? fs.createWriteStream(config.pgLogQueriesFile, { flags: "a" })
        : null;

if (PG_LOG_QUERIES) {
    const originalQuery = postgres.query.bind(postgres);

    postgres.query = function (textOrConfig, values, callback) {
        // Callback forma arba Submittable (turi .submit, pvz. QueryStream) – nepaliesta.
        if (
            typeof values === "function" ||
            typeof callback === "function" ||
            (textOrConfig && typeof textOrConfig.submit === "function")
        ) {
            return originalQuery(textOrConfig, values, callback);
        }

        const sql =
            typeof textOrConfig === "string"
                ? textOrConfig
                : (textOrConfig?.text ?? "");
        const start = performance.now();

        return originalQuery(textOrConfig, values).then(
            (res) => {
                logPgQuery(sql, start, res, null);
                return res;
            },
            (err) => {
                logPgQuery(sql, start, null, err);
                throw err;
            },
        );
    };
}

function pgPad2(n) {
    return n < 10 ? "0" + n : "" + n;
}

/**
 * Loguoja vieną SQL užklausą su trukme ir rezultato dydžiu.
 * @param {string} sql
 * @param {number} start - performance.now() reikšmė prieš užklausą.
 * @param {import("pg").QueryResult | null} res
 * @param {Error | null} err
 */
function logPgQuery(sql, start, res, err) {
    const ms = performance.now() - start;
    // Greitas sėkmingas – praleidžiam; klaidas loginam visada.
    if (!err && ms < PG_LOG_QUERIES_MIN_MS) return;
    const now = new Date();
    const time = `${pgPad2(now.getHours())}:${pgPad2(now.getMinutes())}:${pgPad2(now.getSeconds())}`;
    const gray = "\x1b[90m";
    const reset = "\x1b[0m";
    const cyan = "\x1b[36m";
    const yellow = "\x1b[33m";
    const red = "\x1b[31m";

    const flat = sql.replace(/\s+/g, " ").trim().slice(0, 300);
    const color = err ? red : ms > 100 ? yellow : cyan;
    const meta = err
        ? `KLAIDA ${err.code ?? ""}`.trim()
        : `${res?.rowCount ?? 0} eil.`;

    console.log(
        `${gray}[${time}]${reset} ${color}[pg ${ms.toFixed(1)}ms]${reset} ${gray}${meta}${reset} ${flat}`,
    );

    if (pgLogFileStream) {
        // Į failą – be ANSI spalvų, su pilna data, kad tiktų grep'ui/analizei.
        pgLogFileStream.write(
            `${now.toISOString()} [pg ${ms.toFixed(1)}ms] ${meta} ${flat}\n`,
        );
    }
}

export function parsePgArray(str) {
    if (str == null) return [];
    if (Array.isArray(str)) return str;
    if (typeof str !== "string") return [];

    const result = [];
    let current = "";
    let inQuotes = false;

    // Strip outer braces
    const s = str.slice(1, -1);
    if (!s.length) return [];

    for (let i = 0; i < s.length; i++) {
        const char = s[i];

        // Handle escaped quote \"
        if (char === "\\" && s[i + 1] === '"') {
            current += '"'; // add literal quote
            i++; // skip the "
            continue;
        }

        // Handle unescaped quote → toggle inQuotes
        if (char === '"') {
            inQuotes = !inQuotes;
            continue;
        }

        // Comma outside quotes → end of element
        if (char === "," && !inQuotes) {
            result.push(current);
            current = "";
            continue;
        }

        // Everything else, including backslashes and newlines
        current += char;
    }

    result.push(current); // push last element
    return result;
}
