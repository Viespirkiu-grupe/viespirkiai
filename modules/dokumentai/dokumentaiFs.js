import fs from "fs";
import path from "path";
import config from "../../config.js";

function isRemoteLocation(location) {
    return location?.startsWith("http://") || location?.startsWith("https://");
}

export function getDokumentasPath(md5) {
    if (!config.dokumentaiLocation || isRemoteLocation(config.dokumentaiLocation)) return null;
    return path.join(config.dokumentaiLocation, ...md5.slice(0, 5).split(""), `${md5}.json`);
}

export async function saveDokumentasFs(md5, sidecar) {
    if (isRemoteLocation(config.dokumentaiLocation)) {
        throw new Error(`dokumentaiLocation yra nuotolinis URL, negalima išsaugoti lokaliai (md5=${md5})`);
    }
    const filePath = getDokumentasPath(md5);
    if (!filePath) {
        throw new Error(`dokumentaiLocation nenustatytas, negalima išsaugoti dokumento (md5=${md5})`);
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(sidecar));
}

export async function readDokumentasFs(md5) {
    if (!md5) return null;
    if (isRemoteLocation(config.dokumentaiLocation)) {
        try {
            const url = `${config.dokumentaiLocation}?md5=${encodeURIComponent(md5)}`;
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }
    const filePath = getDokumentasPath(md5);
    if (!filePath) return null;
    try {
        const content = await fs.promises.readFile(filePath, "utf8");
        return JSON.parse(content);
    } catch {
        return null;
    }
}

export async function dokumentasFsExists(md5) {
    if (!md5) return false;
    const filePath = getDokumentasPath(md5);
    if (!filePath) return false;
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}
