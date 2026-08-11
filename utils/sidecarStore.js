import { createHash } from "crypto";
import { createCompressedSqliteStore } from "./sqliteSidecarStore.js";
import { sidecarRemoteUrl } from "./sidecarPaths.js";

/*
Bendra „sidecar" saugyklų logika.

Sidecar lokaliai gyvena tik zstd SQLite saugykloje, kurios kelias išvedamas iš
registro vardo (`utils/sidecarPaths.js`). Mazgas be `SIDECAR_DIR` skaito per
`SIDECAR_REMOTE` — tą patį `/api/v1/sidecar/<vardas>` endpoint'ą, kurį
aptarnauja mazgas su lokaliais failais. Visi write'ai reikalauja `SIDECAR_DIR`;
per HTTP rašyti negalima.

Anksčiau šią logiką turėjo penki failai su savo kopija (`dokumentaiFs`,
`failaiFs`, `tekstasFs`, `metaduomenysFs`, `rezultataiFs`), ir kopijos buvo
nevienodo pilnumo — dviejose trūko `exists()`, viena naudojo `hash=` vietoj
`md5=` URL parametro. Dabar raktas visur `md5`, o skirtumai yra sąmoninga
konfigūracija.
*/

/**
 * @param {object} p
 * @param {string} p.sidecar - registro vardas, pvz. „dokumentai" (žr. utils/sidecarPaths.js).
 * @param {string} p.label - kilmininko linksniu, klaidų tekstams: „dokumento", „teksto".
 * @param {(value: unknown) => string} [p.serialize] - reikšmė → failo turinys.
 * @param {(text: string) => unknown} [p.deserialize] - failo turinys → reikšmė.
 * @returns {{
 *   save: (key: string, value: unknown) => Promise<void>,
 *   saveRaw: (key: string, contents: string) => Promise<void>,
 *   readRaw: (key: string) => Promise<string|null>,
 *   readLocalRaw: (key: string) => Promise<string|null>,
 *   readLocalManyRaw: (keys: string[]) => Promise<Map<string, string>>,
 *   read: (key: string) => Promise<unknown|null>,
 *   exists: (key: string) => Promise<boolean>,
 *   hash: (value: unknown) => string,
 *   prepare: (value: unknown) => { hash: string, contents: string },
 * }}
 */
export function createSidecarStore({
    sidecar,
    label,
    serialize = (value) => JSON.stringify(value),
    deserialize = (text) => JSON.parse(text),
}) {
    const sqlite = createCompressedSqliteStore({ sidecar });

    function localConfigured() {
        return sqlite.configured();
    }

    async function saveRaw(key, contents) {
        if (!sqlite.configured()) {
            throw new Error(
                `SIDECAR_DIR nenustatytas, negalima išsaugoti ${label} (md5=${key})`,
            );
        }
        return sqlite.saveRaw(key, contents);
    }

    async function save(key, value) {
        return saveRaw(key, serialize(value));
    }

    async function readHttpRaw(key) {
        if (!key) return null;
        // URL sudarom kviečiant — konfigūracija gali būti pakeista testuose.
        const url = sidecarRemoteUrl(sidecar);
        if (!url) return null;
        try {
            const res = await fetch(`${url}?md5=${encodeURIComponent(key)}`);
            if (!res.ok) return null;
            return await res.text();
        } catch {
            return null;
        }
    }

    async function readRawFromSqlite(key) {
        if (!sqlite.configured()) return null;
        try {
            return await sqlite.readRaw(key);
        } catch (error) {
            console.error(`${sidecar} SQLite skaitymo klaida (md5=${key}):`, error);
            return null;
        }
    }

    async function readRaw(key) {
        if (!key) return null;
        const sqliteValue = await readRawFromSqlite(key);
        return sqliteValue !== null ? sqliteValue : readHttpRaw(key);
    }

    async function readLocalRaw(key) {
        if (!key) return null;
        return readRawFromSqlite(key);
    }

    /** Partija iš lokalaus SQLite; grąžina `Map<md5, tekstas>` tik su rastais. */
    async function readLocalManyRaw(keys) {
        if (!sqlite.configured()) return new Map();
        return sqlite.readManyRaw(keys);
    }

    async function read(key) {
        const text = await readRaw(key);
        if (text === null) return null;
        try {
            return deserialize(text);
        } catch {
            return null;
        }
    }

    async function exists(key) {
        if (!key) return false;
        if (sqlite.configured()) {
            try {
                if (sqlite.exists(key)) return true;
            } catch (error) {
                console.error(`${sidecar} SQLite exists klaida (md5=${key}):`, error);
            }
        }
        return false;
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

    return {
        save,
        saveRaw,
        read,
        readRaw,
        readLocalRaw,
        readLocalManyRaw,
        readHttpRaw,
        localConfigured,
        exists,
        hash,
        prepare,
    };
}
