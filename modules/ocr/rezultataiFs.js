import fs from "fs";
import path from "path";
import config from "../../config.js";
import { parsePgArray } from "../../postgres/postgres.js";

export function getRezultatasPath(md5) {
    if (!config.ocrRezultataiLocation) return null;
    return path.join(config.ocrRezultataiLocation, ...md5.slice(0, 5).split(""), `${md5}.json`);
}

export async function saveRezultatasFs(rezultatas) {
    const filePath = getRezultatasPath(rezultatas.md5);
    if (!filePath) {
        throw new Error(`ocrRezultataiLocation nenustatytas, negalima išsaugoti OCR rezultato (md5=${rezultatas.md5})`);
    }
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    await fs.promises.writeFile(filePath, JSON.stringify(rezultatas));
}

export async function readRezultatasFs(md5) {
    if (!md5) return null;
    const filePath = getRezultatasPath(md5);
    if (!filePath) return null;
    try {
        const content = await fs.promises.readFile(filePath, "utf8");
        const rezultatas = JSON.parse(content);
        if (typeof rezultatas.tekstas === "string") {
            rezultatas.tekstas = parsePgArray(rezultatas.tekstas);
        }
        return rezultatas;
    } catch {
        return null;
    }
}
