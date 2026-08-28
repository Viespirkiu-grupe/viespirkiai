// Sidecar skaitymo gijų pool'as.
//
// Kodėl jo reikia: `node:sqlite` sinchroninis, tad N atsitiktinių raktų vienoje
// gijoje virsta N nuosekliai laukiamų disko kelionių — 50 raktų iš `dokumentai`
// (66 GB, į RAM netelpa) trunka ~90 ms ir tiek pat blokuoja event loop'ą.
// Flash diskas tuos I/O aptarnauja lygiagrečiai, jei tik yra kam jų paprašyti:
// 4 gijos duoda ~33 ms, 8 — ~25 ms, toliau prisisotina (`benchmarks/sidecarSkaitymas.js`).
//
// Gijų skaičius — `SIDECAR_READ_THREADS`; `1` pool'ą išjungia visiškai.
//
// Darbininko kodas laikomas ČIA, eilutėje, ir paleidžiamas per `eval: true`.
// Atskiras failas neveiktų: Astro/Vite serverio build'as viską subundlina į
// `dist/server/chunks/`, tad `new URL("./skaitytojas.js", import.meta.url)`
// produkcijoje rodo į neegzistuojantį failą (`MODULE_NOT_FOUND`), o runtime
// image'e apskritai yra tik `dist/`. Inline šaltinis neturi ko išbundlinti ir
// naudoja tik `node:` builtin'us.

import fs from "node:fs";
import { Worker } from "node:worker_threads";
import config from "./config.js";
import { DEFAULT_SQLITE_PRAGMAS } from "./sqlite.js";

// Kiekviena darbininko jungtis turi savo puslapių cache, tad numatytasis
// (~256 MB) čia būtų dauginamas iš gijų skaičiaus. 32 MB gijai pakanka —
// karštus indekso puslapius laiko ir OS puslapių cache.
const DARBININKO_CACHE = -32768;

// Darbininke skaitom SINCHRONIŠKAI (ir SQLite, ir zstd): gija tam ir skirta, o
// async overhead'as čia tik pridėtų darbo. Užklausa ateina jau paruošta —
// identifikatorius citavo ir patikrino iškviečiantysis.
const DARBININKO_KODAS = `
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const { zstdDecompressSync } = require("node:zlib");

const db = new DatabaseSync(workerData.dbPath, { readOnly: true });
for (const pragma of workerData.pragmos) db.exec(pragma);
const stmt = db.prepare(workerData.sql);

parentPort.on("message", ({ id, keys }) => {
    try {
        const rows = stmt.all(JSON.stringify(keys));
        const poros = rows.map((row) => [
            row.raktas,
            zstdDecompressSync(row.turinys).toString("utf8"),
        ]);
        parentPort.postMessage({ id, poros });
    } catch (error) {
        parentPort.postMessage({ id, klaida: error?.stack || String(error) });
    }
});
`;

/** @type {Map<string, ReturnType<typeof sukurtiPoola>>} */
const poolai = new Map();

// Kartą nulūžęs pool'as nebekeliamas: krentam į skaitymą pagrindinėje gijoje ir
// nebemokam už bandymus. Lėtas skaitymas yra gerai, o štai tylus tuščias
// rezultatas — ne (taip buvo pradingę dokumentų aprašymai ir paieška).
let gijosIsjungtos = false;

/** Kiek gijų naudoti; konfigūracija skaitoma kvietimo metu (testai ją keičia). */
export function gijuSkaicius() {
    const n = config.sidecarReadThreads;
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.floor(n);
}

function pragmos(cacheSize) {
    const p = { ...DEFAULT_SQLITE_PRAGMAS, cacheSize };
    // Readonly jungčiai — jokio `journal_mode`/`page_size`: tai rašymai į failo
    // antraštę (žr. utils/sqlite.js).
    return [
        `PRAGMA busy_timeout = ${p.busyTimeout}`,
        "PRAGMA synchronous = NORMAL",
        "PRAGMA temp_store = MEMORY",
        `PRAGMA cache_size = ${p.cacheSize}`,
        `PRAGMA mmap_size = ${p.mmapSize}`,
    ];
}

function sukurtiPoola({ dbPath, sql, gijos }) {
    const laukia = new Map();
    let kitasId = 0;
    let miręs = false;

    /** Visi laukiantys gauna klaidą — kabantis promise blogiau nei lūžis. */
    function nutraukti(error) {
        miręs = true;
        for (const [id, l] of [...laukia]) {
            laukia.delete(id);
            l.reject(error);
        }
    }

    const workers = Array.from({ length: gijos }, () => {
        const w = new Worker(DARBININKO_KODAS, {
            eval: true,
            workerData: { dbPath, sql, pragmos: pragmos(DARBININKO_CACHE) },
        });
        w.on("message", ({ id, poros, klaida }) => {
            const laukiantis = laukia.get(id);
            if (!laukiantis) return;
            laukia.delete(id);
            if (klaida) laukiantis.reject(new Error(klaida));
            else laukiantis.resolve(poros);
        });
        w.on("error", (error) => nutraukti(error));
        // Gija, mirusi be „error" (pvz. OOM), kitaip paliktų amžinai kabančius
        // laukiančiuosius.
        w.on("exit", (code) => {
            if (!miręs && code !== 0) nutraukti(new Error(`skaitymo gija baigėsi su kodu ${code}`));
        });
        // Laisva gija neturi laikyti proceso gyvo; skaitymo metu — priešingai.
        w.unref();
        return w;
    });

    // Gijos `unref`intos, tad laukiantis atsakymo procesas neturėtų event loop'e
    // nė vieno handle'o ir Node tyliai baigtų darbą viduryje skaitymo.
    let vykdoma = 0;

    function siusti(worker, keys) {
        const id = kitasId++;
        if (vykdoma++ === 0) for (const w of workers) w.ref();
        const baigti = () => {
            if (--vykdoma === 0) for (const w of workers) w.unref();
        };
        return new Promise((resolve, reject) => {
            laukia.set(id, {
                resolve: (value) => { baigti(); resolve(value); },
                reject: (error) => { baigti(); reject(error); },
            });
            worker.postMessage({ id, keys });
        });
    }

    return {
        gijos,
        /** Raktai padalinami gijoms ir surenkami atgal į vieną `Map`. */
        async readManyRaw(keys) {
            const found = new Map();
            if (!keys.length) return found;

            // Daugiau gijų nei raktų nereikia – tuščias gabalas būtų tuščia
            // kelionė per postMessage.
            const naudojamos = Math.min(gijos, keys.length);
            const gabalai = Array.from({ length: naudojamos }, () => []);
            keys.forEach((key, i) => gabalai[i % naudojamos].push(key));

            const atsakymai = await Promise.all(
                gabalai.map((gabalas, i) => siusti(workers[i], gabalas)),
            );
            for (const poros of atsakymai) {
                for (const [key, text] of poros) found.set(key, text);
            }
            return found;
        },
        close() {
            miręs = true;
            for (const w of workers) void w.terminate();
            laukia.clear();
        },
    };
}

/**
 * Pool'as konkrečiam failui+lentelei arba `null`, jei gijos išjungtos, bazės
 * failo dar nėra arba pool'as jau buvo nulūžęs — visais atvejais kviečiantysis
 * skaito pagrindinėje gijoje.
 *
 * @param {object} p
 * @param {string} p.dbPath
 * @param {string} p.table - jau citatuotas identifikatorius
 * @param {string} p.keyColumn - jau citatuotas identifikatorius
 */
export function gautiPoola({ dbPath, table, keyColumn }) {
    if (gijosIsjungtos) return null;
    const gijos = gijuSkaicius();
    if (gijos < 2) return null;
    if (!fs.existsSync(dbPath)) return null;

    const cacheKey = `${dbPath}\0${table}`;
    let poolas = poolai.get(cacheKey);
    if (poolas && poolas.gijos !== gijos) {
        // Konfigūracija pasikeitė (testai) — pool'ą persukam.
        poolas.close();
        poolas = null;
        poolai.delete(cacheKey);
    }
    if (!poolas) {
        const sql = `SELECT ${keyColumn} AS "raktas", "turinys" FROM ${table}
                     WHERE ${keyColumn} IN (SELECT value FROM json_each(?))`;
        poolas = sukurtiPoola({ dbPath, sql, gijos });
        poolai.set(cacheKey, poolas);
    }
    return poolas;
}

/**
 * Visam procesui išjungia gijas ir sustabdo esamas. Kviečiama, kai pool'as
 * nulūžta: skaitymas tęsiamas pagrindinėje gijoje.
 */
export function isjungtiGijas(priezastis) {
    if (gijosIsjungtos) return;
    gijosIsjungtos = true;
    console.error("Sidecar skaitymo gijos išjungtos, skaitom pagrindinėje gijoje:", priezastis);
    uzdarytiPoolus();
}

/** Sustabdo visas gijas; kviečiama iš `closeCompressedSqliteStores()`. */
export function uzdarytiPoolus() {
    for (const poolas of poolai.values()) poolas.close();
    poolai.clear();
}

/** Testams: leidžia po tyčinio lūžio vėl įjungti gijas. */
export function atstatytiGijas() {
    gijosIsjungtos = false;
}
