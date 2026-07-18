import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import config from "../../utils/config.js";

function isRemoteLocation(location) {
    return location?.startsWith("http://") || location?.startsWith("https://");
}

export function getFailaiPath(hash) {
    if (!config.failaiLocation || isRemoteLocation(config.failaiLocation)) return null;
    return path.join(config.failaiLocation, ...hash.slice(0, 5).split(""), `${hash}.json`);
}

/**
 * Sujungto failo turinio objekto hash (raktas FS saugykloje).
 * @param {Object} failas - { tekstas, metaduomenys, iban, jarKodai, links, emails, domains, telefonai }
 * @returns {string} md5 hex
 */
export function hashFailai(failas) {
    const str = failas == null ? "" : JSON.stringify(failas);
    return createHash("md5").update(str).digest("hex");
}

/**
 * Serialize content once so hashing and writing use exactly the same bytes.
 * @param {Object} failas
 * @returns {{ hash: string, json: string }}
 */
export function prepareFailaiFs(failas) {
    const json = failas == null ? "" : JSON.stringify(failas);
    const hash = createHash("md5").update(json).digest("hex");
    return { hash, json };
}

export async function saveFailaiFs(hash, failas) {
    return savePreparedFailaiFs(hash, JSON.stringify(failas));
}

/** Write content already serialized by prepareFailaiFs(). */
export async function savePreparedFailaiFs(hash, json) {
    if (isRemoteLocation(config.failaiLocation)) {
        throw new Error(`failaiLocation yra nuotolinis URL, negalima išsaugoti lokaliai (hash=${hash})`);
    }
    const filePath = getFailaiPath(hash);
    if (!filePath) {
        throw new Error(`failaiLocation nenustatytas, negalima išsaugoti failo turinio (hash=${hash})`);
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, json);
}

export async function readFailaiFs(hash) {
    if (!hash) return null;
    if (isRemoteLocation(config.failaiLocation)) {
        try {
            const url = `${config.failaiLocation}?hash=${encodeURIComponent(hash)}`;
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }
    const filePath = getFailaiPath(hash);
    if (!filePath) return null;
    try {
        const content = await fs.promises.readFile(filePath, "utf8");
        return JSON.parse(content);
    } catch {
        return null;
    }
}
