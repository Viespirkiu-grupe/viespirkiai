import fs from "node:fs";
import crypto from "node:crypto";
import config from "../utils/config.js";
import {
    enqueueSqlLog,
    sqlLogQuickwitEnabled,
} from "../quickwit/sqlLogIngest.js";
import {
    APP_ENV,
    APP_ROLE,
    getRequestContext,
} from "../utils/runtimeContext.js";
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
// failą JSONL formatu (po vieną JSON objektą eilutėje) su trukme, normalizuotos
// užklausos md5 ir pool'o būsena. Be jokių parametrų reikšmių, o pasikartojantys
// placeholder'iai suvedami į vieną (žr. normalizeSql), kad `IN ($1..$5000)`
// netaptų megabaitine eilute ir kad tokias pačias užklausas būtų galima grupuoti
// (`md5` yra tos pačios normalizuotos formos hash'as – patogus GROUP BY raktas).
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
// SQL_LOG_QUICKWIT – tie patys dokumentai rašomi tiesiai į Quickwit dienos
// indeksą (be shard'ų ir versijų). Į Quickwit siunčiamas TIK `md5`, be teksto:
// išmatuota, kad 390 tūkst. dokumentų tenka ~270 skirtingų užklausų formų, tad
// tekstas ten kartotųsi ~1400 kartų. Patį tekstą laiko `sqlLogTekstai` lentelė.
const SQL_LOG_ENABLED = Boolean(sqlLogFileStream) || sqlLogQuickwitEnabled;

/** Žyma užklausai, kurios pačios loginti nereikia (išvengiam rekursijos). */
const SKIP_LOG = Symbol.for("viespirkiai.sqlLogSkip");
/** Šiame procese jau įrašytos (arba bandytos įrašyti) md5 reikšmės. */
const zinomiTekstai = new Set();
let tekstuRasymasIsjungtas = false;

/**
 * Įsimena md5 → normalizuota užklausa `sqlLogTekstai` lentelėje (insert-only).
 * Kviečiama tik pirmą kartą pamačius formą, o pati įterpimo užklausa į logą
 * nepatenka. Klaidos nurijamos – logavimas negali griauti darbo.
 *
 * @param {string} md5
 * @param {string} sql
 */
function registruotiSqlTeksta(md5, sql) {
    if (tekstuRasymasIsjungtas || zinomiTekstai.has(md5)) return;
    zinomiTekstai.add(md5);

    postgres
        .query({
            text: `INSERT INTO public."sqlLogTekstai" ("md5", "sql")
                   VALUES ($1, $2)
                   ON CONFLICT ("md5") DO NOTHING`,
            values: [md5, sql],
            [SKIP_LOG]: true,
        })
        .catch((err) => {
            // 42P01 – nėra lentelės, 25006 – read-only jungtis: bandyti toliau
            // nėra prasmės. Kitos klaidos gali būti laikinos, tad leidžiam kartoti.
            if (err?.code === "42P01" || err?.code === "25006") {
                tekstuRasymasIsjungtas = true;
                console.warn(
                    `[sqlLogTekstai] rašymas išjungtas (${err.code}): ${err.message}`,
                );
                return;
            }
            zinomiTekstai.delete(md5);
        });
}

/** Maks. į SQL_LOG_FILE rašomos (jau normalizuotos) užklausos ilgis. */
const SQL_LOG_MAX_LEN = 10_000;
/** Normalizavimo + md5 kešas; ta pati užklausa kartojasi tūkstančius kartų. */
const SQL_META_CACHE_MAX = 5_000;
const sqlMetaCache = new Map();

/**
 * Normalizuota užklausa ir jos md5. Hash'as skaičiuojamas nuo PILNOS
 * normalizuotos formos – ir tada, kai į logą rašomas tekstas nukerpamas ties
 * SQL_LOG_MAX_LEN, tad ilgos užklausos vis tiek grupuojasi teisingai.
 * @param {string} rawSql
 */
function sqlMeta(rawSql) {
    const cached = sqlMetaCache.get(rawSql);
    if (cached) return cached;

    const normalized = normalizeSql(rawSql);
    const meta = {
        sql:
            normalized.length > SQL_LOG_MAX_LEN
                ? normalized.slice(0, SQL_LOG_MAX_LEN) + "…"
                : normalized,
        md5: crypto.createHash("md5").update(normalized).digest("hex"),
        op: sqlOperation(normalized),
    };

    // Paprastas apsauginis limitas – be LRU, tiesiog išvalom prisipildžius.
    if (sqlMetaCache.size >= SQL_META_CACHE_MAX) sqlMetaCache.clear();
    sqlMetaCache.set(rawSql, meta);
    return meta;
}

/**
 * Apgaubia query funkciją logavimu, išsaugant originalią semantiką.
 * @param {Function} originalQuery - jau .bind()'inta query funkcija.
 * @param {"pool" | "client"} source - `pool` trukmė apima ir laukimą eilėje
 *   prie laisvos jungties, `client` – tik vykdymą (jungtis jau paimta).
 */
function withQueryLogging(originalQuery, source) {
    return function (textOrConfig, values, callback) {
        // Callback forma, Submittable (turi .submit, pvz. QueryStream) arba
        // pažymėta kaip neloginama (`sqlLogTekstai` įrašas) – nepaliesta.
        if (
            typeof values === "function" ||
            typeof callback === "function" ||
            (textOrConfig && typeof textOrConfig.submit === "function") ||
            textOrConfig?.[SKIP_LOG]
        ) {
            return originalQuery(textOrConfig, values, callback);
        }

        const sql =
            typeof textOrConfig === "string"
                ? textOrConfig
                : (textOrConfig?.text ?? "");
        // Pool'o būsena PADAVIMO momentu – iš jos matyti, ar užklausa turėjo
        // laukti laisvos jungties (žr. `queued` logo lauke).
        const pool = {
            total: postgres.totalCount,
            idle: postgres.idleCount,
            waiting: postgres.waitingCount,
        };
        const start = performance.now();

        return originalQuery(textOrConfig, values).then(
            (res) => {
                logPgQuery(sql, start, res, null, source, pool);
                return res;
            },
            (err) => {
                logPgQuery(sql, start, null, err, source, pool);
                throw err;
            },
        );
    };
}

if (PG_LOG_QUERIES || SQL_LOG_ENABLED) {
    postgres.query = withQueryLogging(postgres.query.bind(postgres), "pool");
}

// Pool'o klientai (tranzakcijos, batch'ai) – apgaubiam tik SQL_LOG_FILE režimu,
// kad "visos užklausos" reikštų tikrai visas. Klientai pool'e naudojami
// pakartotinai, todėl žymim, kad neapgaubtume to paties kliento du kartus.
if (SQL_LOG_ENABLED) {
    const WRAPPED = Symbol.for("viespirkiai.sqlLogWrapped");
    const originalConnect = postgres.connect.bind(postgres);

    const wrapClient = (client) => {
        if (!client || client[WRAPPED]) return client;
        client[WRAPPED] = true;
        client.query = withQueryLogging(client.query.bind(client), "client");
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
 * Pašalina SQL komentarus (`-- iki eilutės galo` ir `/* … *\/`), neliesdamas jų
 * eilučių literaluose, cituotuose identifikatoriuose ar `$$`-blokuose.
 *
 * Reikalinga dviem dalykams: (1) suplokštinus eilutes `--` komentaras kitaip
 * „suvalgytų" likusią užklausą, (2) be komentarų vienodos užklausos gražiau
 * grupuojasi ir logas nesipučia.
 *
 * @param {string} sql
 */
export function stripSqlComments(sql) {
    const text = String(sql ?? "");
    let out = "";
    let i = 0;

    while (i < text.length) {
        const ch = text[i];

        // '…' literalas ('' – pakartotas apostrofas viduje)
        if (ch === "'") {
            const start = i++;
            while (i < text.length) {
                if (text[i] === "'") {
                    if (text[i + 1] === "'") i += 2;
                    else {
                        i++;
                        break;
                    }
                } else i++;
            }
            out += text.slice(start, i);
            continue;
        }

        // "…" identifikatorius
        if (ch === '"') {
            const start = i++;
            while (i < text.length) {
                if (text[i] === '"') {
                    if (text[i + 1] === '"') i += 2;
                    else {
                        i++;
                        break;
                    }
                } else i++;
            }
            out += text.slice(start, i);
            continue;
        }

        // $$ … $$ arba $tag$ … $tag$ (plpgsql funkcijų kūnai)
        if (ch === "$") {
            const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i));
            if (tag) {
                const end = text.indexOf(tag[0], i + tag[0].length);
                const stop = end === -1 ? text.length : end + tag[0].length;
                out += text.slice(i, stop);
                i = stop;
                continue;
            }
        }

        // -- iki eilutės galo
        if (ch === "-" && text[i + 1] === "-") {
            const nl = text.indexOf("\n", i);
            i = nl === -1 ? text.length : nl;
            out += " ";
            continue;
        }

        // /* … */ (Postgres leidžia įdėtinius)
        if (ch === "/" && text[i + 1] === "*") {
            let depth = 1;
            i += 2;
            while (i < text.length && depth > 0) {
                if (text[i] === "/" && text[i + 1] === "*") {
                    depth++;
                    i += 2;
                } else if (text[i] === "*" && text[i + 1] === "/") {
                    depth--;
                    i += 2;
                } else i++;
            }
            out += " ";
            continue;
        }

        out += ch;
        i++;
    }

    return out;
}

/**
 * Užklausos tipas iš pirmo reikšminio žodžio: `select` | `insert` | `update` |
 * `delete` | `schema` (DDL) | `tx` (BEGIN/COMMIT/…) | `other`.
 *
 * `WITH …` atveju žiūrima, ar CTE viduje/gale yra rašymo veiksmas – toks
 * sakinys klasifikuojamas kaip rašymas, ne kaip `select`.
 *
 * @param {string} normalizedSql - jau be komentarų, viena eilute.
 */
export function sqlOperation(normalizedSql) {
    const sql = normalizedSql.replace(/^[\s(]+/, "").toUpperCase();

    if (sql.startsWith("WITH ")) {
        if (/\bINSERT\s+INTO\b/.test(sql)) return "insert";
        if (/\bUPDATE\s+\S+\s+SET\b/.test(sql)) return "update";
        if (/\bDELETE\s+FROM\b/.test(sql)) return "delete";
        return "select";
    }

    const [word] = sql.split(/[^A-Z]/, 1);
    switch (word) {
        case "SELECT":
        case "TABLE":
        case "VALUES":
            return "select";
        case "INSERT":
            return "insert";
        case "UPDATE":
            return "update";
        case "DELETE":
            return "delete";
        case "CREATE":
        case "ALTER":
        case "DROP":
        case "TRUNCATE":
        case "COMMENT":
        case "REINDEX":
        case "REFRESH":
        case "GRANT":
        case "REVOKE":
        case "VACUUM":
        case "ANALYZE":
            return "schema";
        case "BEGIN":
        case "START":
        case "COMMIT":
        case "ROLLBACK":
        case "SAVEPOINT":
        case "RELEASE":
        case "END":
            return "tx";
        default:
            return "other";
    }
}

/**
 * Suveda užklausą į vieną eilutę be komentarų ir parametrų reikšmių, sutraukia
 * pasikartojančius placeholder'ius / literalų sąrašus iki vieno.
 * `IN ($1, $2, ... $999)` → `IN ($?)`, `VALUES ($1),($2),($3)` → `VALUES ($?)`.
 * @param {string} sql
 */
export function normalizeSql(sql) {
    return stripSqlComments(sql)
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
 * @param {"pool" | "client"} [source]
 * @param {{ total: number, idle: number, waiting: number }} [pool] - būsena padavimo metu.
 */
function logPgQuery(sql, start, res, err, source, pool) {
    const ms = performance.now() - start;
    const now = new Date();

    if (SQL_LOG_ENABLED) {
        const meta = sqlMeta(sql);
        // Vienas dokumentas abiem gavėjams: failui (JSONL, po objektą eilutėje)
        // ir Quickwit'ui. `ms` reikšmė priklauso nuo `src`:
        //   pool   – laukimas eilėje prie jungties + vykdymas,
        //   client – tik vykdymas (jungtis jau buvo paimta).
        // `queued` = true reiškia, kad padavimo metu laisvų jungčių nebuvo, t. y.
        // į `ms` tikrai įskaičiuotas laukimas.
        // Aplinka ir vaidmuo – pastovūs procesui; hostas yra tik aptarnaujant
        // HTTP užklausą (taskRunner'yje/CLI jo nėra).
        const request = getRequestContext();
        const doc = {
            ts: now.toISOString(),
            ms: Number(ms.toFixed(1)),
            op: meta.op,
            env: APP_ENV,
            role: APP_ROLE,
            ...(request?.host ? { host: request.host } : {}),
            src: source ?? "pool",
            ok: !err,
            ...(err ? { code: err.code ?? null } : { rows: res?.rowCount ?? 0 }),
            md5: meta.md5,
            ...(pool
                ? {
                      pool,
                      queued:
                          source !== "client" &&
                          pool.idle === 0 &&
                          pool.total >= (config.pgMaxConnections ?? 0),
                  }
                : {}),
        };

        // Faile tekstas patogus (grep'as vietoje), Quickwit'ui siunčiam tik md5,
        // o tekstą vieną kartą įrašom į `sqlLogTekstai`.
        if (sqlLogFileStream) {
            sqlLogFileStream.write(
                JSON.stringify({ ...doc, sql: meta.sql }) + "\n",
            );
        }
        if (sqlLogQuickwitEnabled) {
            enqueueSqlLog(doc);
            registruotiSqlTeksta(meta.md5, meta.sql);
        }
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
