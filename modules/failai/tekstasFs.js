import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import config from "../../utils/config.js";

function isRemoteLocation(location) {
    return location?.startsWith("http://") || location?.startsWith("https://");
}

export function getTekstasPath(md5) {
    if (!config.failaiTekstasLocation || isRemoteLocation(config.failaiTekstasLocation)) return null;
    return path.join(config.failaiTekstasLocation, ...md5.slice(0, 5).split(""), `${md5}.txt`);
}

export function hashTekstas(tekstas) {
    const str = tekstas == null ? "" : tekstas;
    return createHash("md5").update(str).digest("hex");
}

export async function saveTekstasFs(md5, tekstas) {
    if (isRemoteLocation(config.failaiTekstasLocation)) {
        throw new Error(`failaiTekstasLocation yra nuotolinis URL, negalima išsaugoti lokaliai (md5=${md5})`);
    }
    const filePath = getTekstasPath(md5);
    if (!filePath) {
        throw new Error(`failaiTekstasLocation nenustatytas, negalima išsaugoti teksto (md5=${md5})`);
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, tekstas ?? "");
}

export async function readTekstasFs(md5) {
    if (!md5) return null;
    if (isRemoteLocation(config.failaiTekstasLocation)) {
        try {
            const url = `${config.failaiTekstasLocation}?md5=${encodeURIComponent(md5)}`;
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.text();
        } catch {
            return null;
        }
    }
    const filePath = getTekstasPath(md5);
    if (!filePath) return null;
    try {
        return await fs.promises.readFile(filePath, "utf8");
    } catch {
        return null;
    }
}

export async function tekstasFsExists(md5) {
    if (!md5) return false;
    const filePath = getTekstasPath(md5);
    if (!filePath) return false;
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
}
