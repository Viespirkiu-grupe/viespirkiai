import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import config from "../../config.js";

function isRemoteLocation(location) {
    return location?.startsWith("http://") || location?.startsWith("https://");
}

export function getMetaduomenysPath(md5) {
    if (!config.failaiMetaduomenysLocation || isRemoteLocation(config.failaiMetaduomenysLocation)) return null;
    return path.join(config.failaiMetaduomenysLocation, ...md5.slice(0, 5).split(""), `${md5}.json`);
}

export function hashMetaduomenys(metaduomenys) {
    const str = metaduomenys == null ? "" : JSON.stringify(metaduomenys);
    return createHash("md5").update(str).digest("hex");
}

export async function saveMetaduomenysFs(md5, metaduomenys) {
    if (isRemoteLocation(config.failaiMetaduomenysLocation)) {
        throw new Error(`failaiMetaduomenysLocation yra nuotolinis URL, negalima išsaugoti lokaliai (md5=${md5})`);
    }
    const filePath = getMetaduomenysPath(md5);
    if (!filePath) {
        throw new Error(`failaiMetaduomenysLocation nenustatytas, negalima išsaugoti metaduomenų (md5=${md5})`);
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(metaduomenys));
}

export async function readMetaduomenysFs(md5) {
    if (!md5) return null;
    if (isRemoteLocation(config.failaiMetaduomenysLocation)) {
        try {
            const url = `${config.failaiMetaduomenysLocation}?md5=${encodeURIComponent(md5)}`;
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.json();
        } catch {
            return null;
        }
    }
    const filePath = getMetaduomenysPath(md5);
    if (!filePath) return null;
    try {
        const content = await fs.promises.readFile(filePath, "utf8");
        return JSON.parse(content);
    } catch {
        return null;
    }
}
