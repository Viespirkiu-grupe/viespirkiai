import path from "node:path";
import { fileURLToPath } from "node:url";

/*
Modulio konfigūracija iš `modules/s3backup/.env`.

Sąmoningai NE per `utils/config.js` — tie raktai naudojami tik čia, todėl
`ENV_MAP` jų nereikia teršti. Elgesys toks pat kaip `utils/configEnv.js`:
tikra aplinka nugali `.env` failą.

`.env` gali aprašyti kelis S3 mazgus (`S3_NODES=hetzner,wasabi`), o CLI
`--mazgas <alias>` pasirenka, su kuriuo dirbama. Kiekvieno mazgo raktai —
`S3_<ALIAS_DIDZIOSIOMIS>_*`.
*/

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(HERE, ".env");

let loaded = false;

/** Įkelia `modules/s3backup/.env` (vieną kartą), neperrašydamas tikros aplinkos. */
export function loadS3backupEnv() {
    if (loaded) return;
    loaded = true;
    try {
        const preexisting = new Set(Object.keys(process.env));
        const snapshot = { ...process.env };
        process.loadEnvFile(ENV_PATH);
        for (const key of preexisting) process.env[key] = snapshot[key];
    } catch {
        // Failo nėra — dirbam tik su tikra aplinka; trūkstamus raktus pagaus validacija.
    }
}

function str(name, fallback = null) {
    const value = process.env[name];
    return value === undefined || value === "" ? fallback : value;
}

function num(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

function bool(name, fallback) {
    const value = String(process.env[name] ?? "").trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
    return fallback;
}

/** `hetzner` → `HETZNER`; brūkšneliai/taškai → pabraukimai, kad tiktų ENV vardui. */
function envAlias(alias) {
    return alias.trim().toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/** Bendri (ne mazgo) nustatymai. */
export function getBendriNustatymai() {
    loadS3backupEnv();
    return {
        downloadBase: str("DOWNLOAD_BASE", "http://10.1.10.1:4000").replace(/\/+$/, ""),
        downloadTimeoutMs: num("DOWNLOAD_TIMEOUT_MS", 600_000),
        concurrency: num("CONCURRENCY", 16),
        inlineMaxBytes: num("INLINE_MAX_BYTES", 25 * 1024 * 1024),
        tempDir: str("TEMP_DIR", "/flashas/viespirkiai/s3backupTmp"),
        multipartPartSize: num("MULTIPART_PART_SIZE", 16 * 1024 * 1024),
        multipartQueueSize: num("MULTIPART_QUEUE_SIZE", 4),
        maxRetries: num("MAX_RETRIES", 5),
        batchSize: num("BATCH_SIZE", 500),
        sqlitePath: str("SQLITE_PATH", "/flashas/viespirkiai/s3backup/s3backup.sqlite"),
    };
}

/** Visų `.env` aprašytų mazgų aliasai. */
export function getMazguAliasai() {
    loadS3backupEnv();
    return (str("S3_NODES", "") ?? "")
        .split(",")
        .map((alias) => alias.trim())
        .filter(Boolean);
}

/**
 * Vieno S3 mazgo konfigūracija. Meta klaidą, jei mazgas neaprašytas arba
 * trūksta privalomų raktų.
 * @param {string} [alias] - jei nenurodyta, imamas `S3_DEFAULT_NODE` arba pirmas iš `S3_NODES`
 */
export function getMazgas(alias) {
    loadS3backupEnv();

    const aliasai = getMazguAliasai();
    if (aliasai.length === 0) {
        throw new Error(`S3_NODES nenustatytas — aprašykite mazgus ${ENV_PATH} faile`);
    }

    const pasirinktas = alias || str("S3_DEFAULT_NODE") || aliasai[0];
    if (!aliasai.includes(pasirinktas)) {
        throw new Error(
            `Nežinomas mazgas „${pasirinktas}" — S3_NODES aprašyti: ${aliasai.join(", ")}`,
        );
    }

    const p = `S3_${envAlias(pasirinktas)}_`;
    const mazgas = {
        alias: pasirinktas,
        endpoint: str(`${p}ENDPOINT`),
        region: str(`${p}REGION`, "us-east-1"),
        bucket: str(`${p}BUCKET`),
        accessKeyId: str(`${p}ACCESS_KEY_ID`),
        secretAccessKey: str(`${p}SECRET_ACCESS_KEY`),
        prefix: str(`${p}PREFIX`, ""),
        forcePathStyle: bool(`${p}FORCE_PATH_STYLE`, true),
        storageClass: str(`${p}STORAGE_CLASS`),
    };

    const truksta = ["endpoint", "bucket", "accessKeyId", "secretAccessKey"].filter(
        (key) => !mazgas[key],
    );
    if (truksta.length) {
        const vardai = truksta
            .map((key) => p + key.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase())
            .join(", ");
        throw new Error(`Mazgui „${pasirinktas}" trūksta: ${vardai}`);
    }

    return mazgas;
}

/**
 * S3 objekto raktas iš md5: `<prefix>ab/cd/ef/<md5>`.
 * Skaidymas į prefiksus išbarsto 3,8 mln. objektų — greitesnis listinimas ir
 * lengvesnis dalinis atkūrimas nei plokščiame bakete.
 */
export function s3Raktas(prefix, md5) {
    return `${prefix}${md5.slice(0, 2)}/${md5.slice(2, 4)}/${md5.slice(4, 6)}/${md5}`;
}
