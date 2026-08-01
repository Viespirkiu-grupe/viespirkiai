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
});

// Debuginimui: config.pgLogQueries įjungia visų per postgres.query() einančių
// užklausų logavimą į konsolę su trukme; loginamos tik trukusios
// >= config.pgLogQueriesMinMs.
//
// Atskirai: SQL_LOG_FILE (config.sqlLogFile) – kai nurodytas, VISOS užklausos
// (ir pool.query(), ir postgres.connect() paimtų klientų) append'inamos į tą
// failą su trukme. Be jokių parametrų reikšmių, o pasikartojantys placeholder'iai
// suvedami į vieną (žr. normalizeSql), kad `IN ($1..$5000)` netaptų megabaitine
// eilute ir kad tokias pačias užklausas būtų galima grupuoti.
//
// Callback ir Submittable (pvz. QueryStream) formos praleidžiamos nepaliestos.
const PG_LOG_QUERIES = config.pgLogQueries === true;
const PG_LOG_QUERIES_MIN_MS = Number(config.pgLogQueriesMinMs) || 0;
// Neprivalomi failai – atidaromi kartą, rašoma append režimu.
const pgLogFileStream =
    PG_LOG_QUERIES && config.pgLogQueriesFile
        ? fs.createWriteStream(config.pgLogQueriesFile, { flags: "a" })
        : null;
const sqlLogFileStream = config.sqlLogFile
    ? fs.createWriteStream(config.sqlLogFile, { flags: "a" })
    : null;

/** Maks. į SQL_LOG_FILE rašomos (jau normalizuotos) užklausos ilgis. */
const SQL_LOG_MAX_LEN = 10_000;

/**
 * Apgaubia query funkciją logavimu, išsaugant originalią semantiką.
 * @param {Function} originalQuery - jau .bind()'inta query funkcija.
 */
function withQueryLogging(originalQuery) {
    return function (textOrConfig, values, callback) {
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

if (PG_LOG_QUERIES || sqlLogFileStream) {
    postgres.query = withQueryLogging(postgres.query.bind(postgres));
}

// Pool'o klientai (tranzakcijos, batch'ai) – apgaubiam tik SQL_LOG_FILE režimu,
// kad "visos užklausos" reikštų tikrai visas. Klientai pool'e naudojami
// pakartotinai, todėl žymim, kad neapgaubtume to paties kliento du kartus.
if (sqlLogFileStream) {
    const WRAPPED = Symbol.for("viespirkiai.sqlLogWrapped");
    const originalConnect = postgres.connect.bind(postgres);

    const wrapClient = (client) => {
        if (!client || client[WRAPPED]) return client;
        client[WRAPPED] = true;
        client.query = withQueryLogging(client.query.bind(client));
        return client;
    };

    postgres.connect = function (callback) {
        if (typeof callback === "function") {
            return originalConnect((err, client, release) =>
                callback(err, wrapClient(client), release),
            );
        }
        return originalConnect().then(wrapClient);
    };
}

/**
 * Suveda užklausą į vieną eilutę be parametrų reikšmių ir sutraukia
 * pasikartojančius placeholder'ius / literalų sąrašus iki vieno.
 * `IN ($1, $2, ... $999)` → `IN ($?)`, `VALUES ($1),($2),($3)` → `VALUES ($?)`.
 * @param {string} sql
 */
export function normalizeSql(sql) {
    return String(sql ?? "")
        .replace(/\s+/g, " ")
        // Visi numeruoti placeholder'iai – į vieną bevardį.
        .replace(/\$\d+/g, "$?")
        // $?, $?, $? → $?
        .replace(/\$\?(?:\s*,\s*\$\?)+/g, "$?")
        // ($?), ($?), ($?) → ($?)  (daugiaeilis VALUES)
        .replace(/\(\s*\$\?\s*\)(?:\s*,\s*\(\s*\$\?\s*\))+/g, "($?)")
        // Inline literalų sąrašai (3+ elementai): (1, 2, 3) / ('a','b','c') → (…)
        .replace(
            /\(\s*(?:'(?:[^']|'')*'|-?\d+(?:\.\d+)?)(?:\s*,\s*(?:'(?:[^']|'')*'|-?\d+(?:\.\d+)?)){2,}\s*\)/g,
            "(…)",
        )
        .trim();
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
    const now = new Date();

    if (sqlLogFileStream) {
        // Tab'ais atskirti stulpeliai: laikas, trukmė (ms), rezultatas, SQL.
        let normalized = normalizeSql(sql);
        if (normalized.length > SQL_LOG_MAX_LEN) {
            normalized = normalized.slice(0, SQL_LOG_MAX_LEN) + "…";
        }
        const status = err ? `ERROR ${err.code ?? ""}`.trim() : "OK";
        sqlLogFileStream.write(
            `${now.toISOString()}\t${ms.toFixed(1)}\t${status}\t${normalized}\n`,
        );
    }

    if (!PG_LOG_QUERIES) return;
    // Greitas sėkmingas – praleidžiam; klaidas loginam visada.
    if (!err && ms < PG_LOG_QUERIES_MIN_MS) return;
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
