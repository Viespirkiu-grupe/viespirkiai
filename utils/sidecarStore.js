import { createHash } from "crypto";
import config from "./config.js";
import { createCompressedSqliteStore } from "./sqliteSidecarStore.js";

/*
Bendra „sidecar" saugyklų logika.

Sidecar lokaliai gyvena tik zstd SQLite saugykloje. `config.<locationKey>` gali
būti HTTP(S) endpoint'as, naudojamas tik kaip nuotolinis read fallback mazguose,
kurie neturi lokalaus SQLite. Visi write'ai reikalauja `sqliteLocationKey`.

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
 * @param {string} p.label - kilmininko linksniu, klaidų tekstams: „dokumento", „teksto".
 * @param {string} [p.sqliteLocationKey] - pilno SQLite failo kelio config raktas.
 * @param {string} [p.sqliteTable] - lentelė suspaustiems blob'ams.
 * @param {string} [p.keyName] - rakto vardas URL parametre ir klaidų tekstuose („md5"/„hash").
 * @param {(value: unknown) => string} [p.serialize] - reikšmė → failo turinys.
 * @param {(text: string) => unknown} [p.deserialize] - failo turinys → reikšmė.
 * @returns {{
 *   save: (key: string, value: unknown) => Promise<void>,
 *   saveRaw: (key: string, contents: string) => Promise<void>,
 *   readRaw: (key: string) => Promise<string|null>,
 *   readLocalRaw: (key: string) => Promise<string|null>,
 *   read: (key: string) => Promise<unknown|null>,
 *   exists: (key: string) => Promise<boolean>,
 *   hash: (value: unknown) => string,
 *   prepare: (value: unknown) => { hash: string, contents: string },
 * }}
 */
export function createSidecarStore({
    locationKey,
    label,
    sqliteLocationKey,
    sqliteTable,
    keyName = "md5",
    serialize = (value) => JSON.stringify(value),
    deserialize = (text) => JSON.parse(text),
}) {
    // Vietą skaitom kviečiant, o ne importuojant — konfigūracija gali būti
    // pakeista testuose arba užkrauta vėliau.
    const remoteLocation = () => isRemoteLocation(config[locationKey])
        ? config[locationKey]
        : null;
    const sqlite = sqliteLocationKey && sqliteTable
        ? createCompressedSqliteStore({ locationKey: sqliteLocationKey, tableName: sqliteTable })
        : null;

    function localConfigured() {
        return Boolean(sqlite?.configured());
    }

    async function saveRaw(key, contents) {
        if (!sqlite?.configured()) {
            throw new Error(
                `${sqliteLocationKey} nenustatytas, negalima išsaugoti ${label} (${keyName}=${key})`,
            );
        }
        return sqlite.saveRaw(key, contents);
    }

    async function save(key, value) {
        return saveRaw(key, serialize(value));
    }

    async function readHttpRaw(key) {
        if (!key) return null;
        const loc = remoteLocation();
        if (!loc) return null;
        try {
            const url = `${loc}?${keyName}=${encodeURIComponent(key)}`;
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.text();
        } catch {
            return null;
        }
    }

    async function readRawFromSqlite(key) {
        if (!sqlite?.configured()) return null;
        try {
            return await sqlite.readRaw(key);
        } catch (error) {
            console.error(`${sqliteLocationKey} SQLite skaitymo klaida (${keyName}=${key}):`, error);
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
        if (sqlite?.configured()) {
            try {
                if (sqlite.exists(key)) return true;
            } catch (error) {
                console.error(`${sqliteLocationKey} SQLite exists klaida (${keyName}=${key}):`, error);
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
        readHttpRaw,
        localConfigured,
        exists,
        hash,
        prepare,
    };
}
