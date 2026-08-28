import fs from "fs";
import path from "path";

/**
 * .env palaikymas: leidžia konfigūraciją paduoti per aplinkos kintamuosius,
 * kad į container'į nebereikėtų montuoti `config.js`.
 *
 * `loadEnvFile()` suranda artimiausią `.env` failą (kylant katalogais nuo
 * `cwd`) ir įkelia jį į `process.env` (esami kintamieji NEperrašomi).
 * `configFromEnv()` iš `process.env` sudaro dalinį config objektą, kurį
 * `utils/config.js` sulieja ant `config.js` (jei toks yra) viršaus.
 */

/**
 * Kiekvienas įrašas: [ENV_VARDAS, configRaktas, tipas].
 * tipas: "string" | "number" | "boolean" | "json" | "csv"
 */
const ENV_MAP = [
    ["CUSTOM_HEAD", "customHead", "string"],
    ["ANALITIKA_URL", "analitikaUrl", "string"],
    ["ONION_ADDRESS", "onionAddress", "string"],

    ["PORT", "port", "number"],
    ["TASKRUNNER_DISABLED_TASKS", "taskRunnerDisabledTasks", "csv"],
    ["APP_ENV", "appEnv", "string"],
    ["LOG_REQUESTS", "logRequests", "boolean"],
    ["ENABLE_ATN1", "enableAtn1", "boolean"],
    ["ENABLE_BOT_CHALLENGE", "enableBotChallenge", "boolean"],

    ["PG_HOST", "pgHost", "string"],
    ["PG_PORT", "pgPort", "number"],
    ["PG_USER", "pgUser", "string"],
    ["PG_PASSWORD", "pgPassword", "string"],
    ["PG_DATABASE", "pgDatabase", "string"],
    ["PG_MAX_CONNECTIONS", "pgMaxConnections", "number"],
    ["PG_DIRECT_HOST", "pgDirectHost", "string"],
    ["PG_DIRECT_PORT", "pgDirectPort", "number"],
    ["SQL_LOG_FILE", "sqlLogFile", "string"],
    ["SQL_LOG_QUICKWIT", "sqlLogQuickwit", "boolean"],
    ["SCRAPE_LOG_FILE", "scrapeLogFile", "string"],
    ["SCRAPE_LOG_QUICKWIT", "scrapeLogQuickwit", "boolean"],
    ["PG_PREPARED", "pgPrepared", "boolean"],

    ["NATS_URL", "natsUrl", "string"],
    ["NATS_TOKEN", "natsToken", "string"],

    ["TYPESENSE_UP", "typesenseUp", "boolean"],
    ["TYPESENSE_NODES", "typesenseNodes", "json"],
    ["TYPESENSE_API_KEY", "typesenseApiKey", "string"],

    ["QUICKWIT_UP", "quickwitUp", "boolean"],
    ["QUICKWIT_URL", "quickwitUrl", "string"],
    ["SUTARTYS_QUICKWIT", "sutartysQuickwit", "boolean"],
    ["VIESIEJI_PIRKIMAI_QUICKWIT", "viesiejiPirkimaiQuickwit", "boolean"],

    ["TOR_ADDRESS", "torAddress", "string"],
    ["TOR_PASSWORD", "torPassword", "string"],

    ["DATA_GOV_URL", "dataGovUrl", "string"],
    ["VIESIEJI_PIRKIMAI_URL", "viesiejiPirkimaiUrl", "string"],
    ["2021_ESINVESTICIJOS", "esInvesticijos2021Url", "string"],

    ["ETAR_API_URL", "eTarApiUrl", "string"],
    ["ETAR_API_KEY", "eTarApiKey", "string"],
    ["ETAR_RECENT_DAYS", "eTarRecentDays", "number"],
    ["ETAR_REFRESH_HOURS", "eTarRefreshHours", "number"],
    ["ETAR_MAX_INFLIGHT", "eTarMaxInflight", "number"],
    ["ESEIMAS_RECENT_DAYS", "eSeimasRecentDays", "number"],
    ["ESEIMAS_REFRESH_HOURS", "eSeimasRefreshHours", "number"],
    ["ESEIMAS_MAX_INFLIGHT", "eSeimasMaxInflight", "number"],

    ["INTERNAL_FILE_BASE", "internalFileBase", "string"],
    ["OCR_BANDYMAI", "ocrBandymai", "number"],

    // Visos sidecar bazės — viename kataloge, po vieną failą; žr. utils/sidecarPaths.js.
    ["SIDECAR_DIR", "sidecarDir", "string"],
    ["SIDECAR_REMOTE", "sidecarRemote", "string"],
    ["SIDECAR_READ_THREADS", "sidecarReadThreads", "number"],

    ["ENABLE_GRAPH", "enableGraph", "boolean"],

    ["ENABLE_EXECUTE_QUERY_MCP", "enableExecuteQueryMcp", "boolean"],
    ["ENABLE_EXECUTE_QUERY_MCP_ONLY", "enableExecuteQueryMcpOnly", "boolean"],
    ["ENABLE_EXECUTE_QUERY_MCP_TRACE", "enableExecuteQueryMcpTrace", "boolean"],
    ["PG_ANALYST_USER", "pgAnalystUser", "string"],
    ["PG_ANALYST_PASSWORD", "pgAnalystPassword", "string"],
    ["PG_ANALYST_PORT", "pgAnalystPort", "number"],
    ["PG_ANALYST_MAX_CONNECTIONS", "pgAnalystMaxConnections", "number"],
    ["MCP_QUERY_TIMEOUT", "mcpQueryTimeout", "number"],

    ["SPINTA_SERVER", "spintaServer", "string"],
    ["SPINTA_API_KEY", "spintaApiKey", "string"],
    ["SPINTA_CLIENT", "spintaClient", "string"],
    ["SPINTA_SECRET", "spintaSecret", "string"],
    ["SPINTA_NAMESPACE", "spintaNamespace", "string"],
    ["SPINTA_SCOPES", "spintaScopes", "json"],
];

function fileExists(filePath) {
    try {
        fs.accessSync(filePath);
        return true;
    } catch {
        return false;
    }
}

/** Suranda artimiausią `.env` failą kylant katalogais nuo `startDir`. */
export function findEnvPath(startDir) {
    let currentDir = path.resolve(startDir);
    while (true) {
        const candidate = path.join(currentDir, ".env");
        if (fileExists(candidate)) return candidate;
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) return null;
        currentDir = parentDir;
    }
}

/**
 * Įkelia `.env` failą į `process.env` (jei toks rastas). Esami aplinkos
 * kintamieji NEperrašomi. Grąžina įkelto failo kelią arba `null`.
 */
export function loadEnvFile(startDir = process.cwd()) {
    const envPath = findEnvPath(startDir);
    if (!envPath) return null;

    try {
        // Įsimenam, kurie kintamieji jau buvo nustatyti prieš įkeliant.
        const preexisting = new Set(Object.keys(process.env));
        // process.loadEnvFile perrašo esamus – todėl juos atstatom.
        const snapshot = { ...process.env };
        process.loadEnvFile(envPath);
        for (const key of preexisting) {
            process.env[key] = snapshot[key];
        }
        return envPath;
    } catch (error) {
        console.error("Error loading .env file:", error);
        return null;
    }
}

function coerce(value, type) {
    switch (type) {
        case "number": {
            const n = Number(value);
            return Number.isFinite(n) ? n : undefined;
        }
        case "boolean": {
            const v = String(value).trim().toLowerCase();
            if (["1", "true", "yes", "on"].includes(v)) return true;
            if (["0", "false", "no", "off", ""].includes(v)) return false;
            return undefined;
        }
        case "csv": {
            const items = String(value)
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean);
            return items.length ? items : undefined;
        }
        case "json": {
            try {
                return JSON.parse(value);
            } catch {
                return undefined;
            }
        }
        default:
            return value;
    }
}

function setNested(target, dottedKey, value) {
    const parts = dottedKey.split(".");
    let node = target;
    for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        if (typeof node[part] !== "object" || node[part] === null) {
            node[part] = {};
        }
        node = node[part];
    }
    node[parts[parts.length - 1]] = value;
}

/**
 * Iš `process.env` sudaro dalinį config objektą. Įtraukiami tik tie raktai,
 * kurių atitinkamas ENV kintamasis yra nustatytas ir tinkamai konvertuojamas.
 */
export function configFromEnv(env = process.env) {
    const out = {};
    for (const [envName, configKey, type] of ENV_MAP) {
        const raw = env[envName];
        if (raw === undefined || raw === "") continue;
        const value = coerce(raw, type);
        if (value === undefined) continue;
        setNested(out, configKey, value);
    }
    return out;
}
