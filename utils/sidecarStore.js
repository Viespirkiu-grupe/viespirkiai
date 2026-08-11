import { createHash } from "crypto";
import { createCompressedSqliteStore } from "./sqliteSidecarStore.js";
import { SIDECAR_BATCH_LIMIT, sidecarRemoteUrl } from "./sidecarPaths.js";

/*
Bendra „sidecar" saugyklų logika.

Sidecar lokaliai gyvena tik zstd SQLite saugykloje, kurios kelias išvedamas iš
registro vardo (`utils/sidecarPaths.js`). Mazgas be `SIDECAR_DIR` skaito per
`SIDECAR_REMOTE` — tą patį `/api/v1/sidecar/<vardas>` endpoint'ą, kurį
aptarnauja mazgas su lokaliais failais. Visi write'ai reikalauja `SIDECAR_DIR`;
per HTTP rašyti negalima.

Skaitymai grupuojami: raktai kaupiami iki artimiausio `setImmediate` ir imami
viena užklausa (lokaliai — vienas `json_each`, nuotoliniu atveju — vienas POST).
Tai veidrodis rašymo grupavimui `sqliteSidecarStore.js`. Todėl kvietėjams, kurie
jau dabar leidžia raktus per `Promise.all` (indeksavimo drain'as po 500,
paieškos rezultatų puslapis), keisti nieko nereikia. Sekvenciniams srautams,
kur per tick'ą ateina po vieną raktą, yra aiškus `readMany`.

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
 *   readMany: (keys: string[]) => Promise<Map<string, unknown>>,
 *   readManyRaw: (keys: string[]) => Promise<Map<string, string>>,
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

    /** Partija iš nuotolinio mazgo — vienas POST vietoj N GET. */
    async function readHttpManyRaw(keys) {
        const found = new Map();
        if (!keys.length) return found;
        const url = sidecarRemoteUrl(sidecar, { batch: true });
        if (!url) return found;
        try {
            const res = await fetch(url, { method: "POST", body: JSON.stringify(keys) });
            if (!res.ok) return found;
            for (const line of (await res.text()).split("\n")) {
                if (!line) continue;
                const row = JSON.parse(line);
                found.set(row.md5, row.turinys);
            }
        } catch (error) {
            console.error(`${sidecar} nuotolinio batch klaida (${keys.length} raktai):`, error);
        }
        return found;
    }

    /** Partija iš lokalaus SQLite; grąžina `Map<md5, tekstas>` tik su rastais. */
    async function readLocalManyRaw(keys) {
        if (!sqlite.configured() || !keys.length) return new Map();
        try {
            return await sqlite.readManyRaw(keys);
        } catch (error) {
            console.error(`${sidecar} SQLite batch skaitymo klaida:`, error);
            return new Map();
        }
    }

    /**
     * Viena partija: lokalus SQLite, o ko jame nėra — nuotolinis mazgas.
     * Ta pati per-raktinė tvarka kaip anksčiau, tik atliekama iš karto visiems.
     */
    async function fetchManyRaw(keys) {
        const found = await readLocalManyRaw(keys);
        const missing = keys.filter((key) => !found.has(key));
        if (!missing.length) return found;

        // Vienam raktui paliekam paprastą GET — jis cache'inasi ir tinka rankai.
        if (missing.length === 1) {
            const value = await readHttpRaw(missing[0]);
            if (value !== null) found.set(missing[0], value);
            return found;
        }
        for (const [key, value] of await readHttpManyRaw(missing)) found.set(key, value);
        return found;
    }

    // Laukiantys skaitymai iki artimiausio `setImmediate`. Veidrodis rašymo
    // grupavimui (`enqueueWrite`): ten viena tranzakcija vietoj N fsync'ų, čia —
    // viena užklausa vietoj N. Map raktas => tie patys raktai tick'e susilieja.
    let pendingReads = new Map();
    let readFlushScheduled = false;

    function enqueueRead(key) {
        return new Promise((resolve) => {
            const waiters = pendingReads.get(key);
            if (waiters) {
                waiters.push(resolve);
                return;
            }
            pendingReads.set(key, [resolve]);
            if (readFlushScheduled) return;
            readFlushScheduled = true;
            setImmediate(() => {
                readFlushScheduled = false;
                const batch = pendingReads;
                pendingReads = new Map();
                void flushReads(batch);
            });
        });
    }

    async function flushReads(batch) {
        const keys = [...batch.keys()];
        // Gabalus imam paeiliui: vienu drain'u gali ateiti ir keli tūkstančiai
        // raktų, o lygiagretūs POST'ai užgriūtų nuotolinį mazgą.
        for (let i = 0; i < keys.length; i += SIDECAR_BATCH_LIMIT) {
            const chunk = keys.slice(i, i + SIDECAR_BATCH_LIMIT);
            // Klaida partijoje neturi nužudyti visų raktų — grąžinam `null`,
            // lygiai kaip anksčiau darė per-rakto `catch`.
            const found = await fetchManyRaw(chunk);
            for (const key of chunk) {
                const value = found.get(key) ?? null;
                for (const resolve of batch.get(key)) resolve(value);
            }
        }
    }

    async function readRaw(key) {
        if (!key) return null;
        return enqueueRead(key);
    }

    async function readLocalRaw(key) {
        if (!key) return null;
        return (await readLocalManyRaw([key])).get(key) ?? null;
    }

    /**
     * Aiškus masinis skaitymas — sekvenciniams srautams, kur grupavimas
     * nepadeda (vienas raktas per tick'ą). Grąžina tik rastus raktus.
     */
    async function readManyRaw(keys) {
        const unique = [...new Set(keys.filter(Boolean))];
        const found = new Map();
        for (let i = 0; i < unique.length; i += SIDECAR_BATCH_LIMIT) {
            const chunk = unique.slice(i, i + SIDECAR_BATCH_LIMIT);
            for (const [key, value] of await fetchManyRaw(chunk)) found.set(key, value);
        }
        return found;
    }

    /** Kaip `readManyRaw`, tik reikšmės jau deserializuotos. */
    async function readMany(keys) {
        const out = new Map();
        for (const [key, text] of await readManyRaw(keys)) {
            try {
                out.set(key, deserialize(text));
            } catch { /* sugadintas įrašas — praleidžiam, kaip ir `read()` */ }
        }
        return out;
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
        readMany,
        readManyRaw,
        readLocalRaw,
        readLocalManyRaw,
        readHttpRaw,
        localConfigured,
        exists,
        hash,
        prepare,
    };
}
