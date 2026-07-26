import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import config from "./config.js";

/*
Bendra „sidecar" saugyklų logika.

Sidecar — tai šalia DB eilutės gyvenantis failas, adresuojamas turinio hash'u
(md5). Kelias sudaromas iš pirmų 5 hash'o simbolių: `a/b/c/d/e/abcde….json` —
taip viename kataloge nesusikaupia milijonai failų.

`config.<locationKey>` gali būti:
  - katalogas → skaitom/rašom tiesiai į failų sistemą;
  - `http(s)://…` → tik skaitymas per HTTP (kitas mazgas atiduoda failą per
    `src/pages/api/.../…Files.ts` endpoint'ą); rašyti nuotoliniu būdu negalima;
  - nenustatytas → `getPath()` grąžina null, `read()` — null, `save()` meta klaidą.

Anksčiau šią logiką turėjo penki failai su savo kopija (`dokumentaiFs`,
`failaiFs`, `tekstasFs`, `metaduomenysFs`, `rezultataiFs`), ir kopijos buvo
nevienodo pilnumo — dviejose trūko `exists()`, viena naudojo `hash=` vietoj
`md5=` URL parametro. Dabar skirtumai yra sąmoninga konfigūracija.
*/

function isRemoteLocation(location) {
    return location?.startsWith("http://") || location?.startsWith("https://");
}

/**
 * @param {object} p
 * @param {string} p.locationKey - `config` rakto vardas, pvz. „dokumentaiLocation".
 * @param {string} p.extension - failo plėtinys be taško, pvz. „json" arba „txt".
 * @param {string} p.label - kilmininko linksniu, klaidų tekstams: „dokumento", „teksto".
 * @param {string} [p.keyName] - rakto vardas URL parametre ir klaidų tekstuose („md5"/„hash").
 * @param {(value: unknown) => string} [p.serialize] - reikšmė → failo turinys.
 * @param {(text: string) => unknown} [p.deserialize] - failo turinys → reikšmė.
 * @returns {{
 *   getPath: (key: string) => string|null,
 *   save: (key: string, value: unknown) => Promise<void>,
 *   saveRaw: (key: string, contents: string) => Promise<void>,
 *   read: (key: string) => Promise<unknown|null>,
 *   exists: (key: string) => Promise<boolean>,
 *   hash: (value: unknown) => string,
 *   prepare: (value: unknown) => { hash: string, contents: string },
 * }}
 */
export function createSidecarStore({
    locationKey,
    extension,
    label,
    keyName = "md5",
    serialize = (value) => JSON.stringify(value),
    deserialize = (text) => JSON.parse(text),
}) {
    // Vietą skaitom kviečiant, o ne importuojant — konfigūracija gali būti
    // pakeista testuose arba užkrauta vėliau.
    const location = () => config[locationKey];

    function getPath(key) {
        const loc = location();
        if (!loc || isRemoteLocation(loc)) return null;
        return path.join(loc, ...key.slice(0, 5).split(""), `${key}.${extension}`);
    }

    async function saveRaw(key, contents) {
        const loc = location();
        if (isRemoteLocation(loc)) {
            throw new Error(
                `${locationKey} yra nuotolinis URL, negalima išsaugoti lokaliai (${keyName}=${key})`,
            );
        }
        const filePath = getPath(key);
        if (!filePath) {
            throw new Error(
                `${locationKey} nenustatytas, negalima išsaugoti ${label} (${keyName}=${key})`,
            );
        }
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, contents);
    }

    async function save(key, value) {
        return saveRaw(key, serialize(value));
    }

    async function read(key) {
        if (!key) return null;
        const loc = location();
        if (isRemoteLocation(loc)) {
            try {
                const url = `${loc}?${keyName}=${encodeURIComponent(key)}`;
                const res = await fetch(url);
                if (!res.ok) return null;
                return deserialize(await res.text());
            } catch {
                return null;
            }
        }
        const filePath = getPath(key);
        if (!filePath) return null;
        try {
            return deserialize(await fs.promises.readFile(filePath, "utf8"));
        } catch {
            return null;
        }
    }

    async function exists(key) {
        if (!key) return false;
        const filePath = getPath(key);
        if (!filePath) return false;
        try {
            await fs.promises.access(filePath, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Serializuoja vieną kartą, kad hash'as ir įrašomi baitai sutaptų tiksliai.
     * Naudinga, kai hash'as yra ir saugojimo raktas (žr. failaiFs).
     */
    function prepare(value) {
        const contents = value == null ? "" : serialize(value);
        return { hash: createHash("md5").update(contents).digest("hex"), contents };
    }

    function hash(value) {
        return prepare(value).hash;
    }

    return { getPath, save, saveRaw, read, exists, hash, prepare };
}
