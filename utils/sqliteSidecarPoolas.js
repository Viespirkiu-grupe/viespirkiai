// Sidecar skaitymo gijų pool'as.
//
// Kodėl jo reikia: `node:sqlite` sinchroninis, tad N atsitiktinių raktų vienoje
// gijoje virsta N nuosekliai laukiamų disko kelionių — 50 raktų iš `dokumentai`
// (66 GB, į RAM netelpa) trunka ~100 ms ir tiek pat blokuoja event loop'ą.
// Flash diskas tuos I/O aptarnauja lygiagrečiai, jei tik yra kam jų paprašyti:
// 4 gijos duoda ~33 ms, 8 — ~25 ms, toliau prisisotina (`benchmarks/sidecarSkaitymas.js`).
//
// Gijų skaičius — `SIDECAR_READ_THREADS`. `1` (ar `0`) pool'ą išjungia visiškai:
// tada skaitoma pagrindinėje gijoje, kaip anksčiau. Tai numatytoji elgsena
// trumpaamžiams CLI procesams nustačius `1`; serveriui ir taskrunneriui verta
// palikti daugiau.

import fs from "node:fs";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import config from "./config.js";

const SKAITYTOJAS = fileURLToPath(new URL("./sqliteSidecarSkaitytojas.js", import.meta.url));

// Kiekviena darbininko jungtis turi savo puslapių cache, tad numatytasis
// (~256 MB) čia būtų dauginamas iš gijų skaičiaus. 32 MB gijai pakanka —
// karštus indekso puslapius laiko ir OS puslapių cache.
const DARBININKO_CACHE = -32768;

/** @type {Map<string, ReturnType<typeof sukurtiPoola>>} */
const poolai = new Map();

/**
 * Kiek gijų naudoti. Konfigūraciją skaitom kvietimo metu (testai ją keičia),
 * o reikšmę ribojam – neigiama ar nesąmoninga virsta viena gija.
 */
export function gijuSkaicius() {
    const n = config.sidecarReadThreads;
    if (!Number.isFinite(n) || n < 1) return 1;
    return Math.floor(n);
}

function sukurtiPoola({ dbPath, table, keyColumn, gijos }) {
    const laukia = new Map();
    let kitasId = 0;

    const workers = Array.from({ length: gijos }, () => {
        const w = new Worker(SKAITYTOJAS, {
            workerData: { dbPath, table, keyColumn, cacheSize: DARBININKO_CACHE },
        });
        w.on("message", ({ id, poros, klaida }) => {
            const laukiantis = laukia.get(id);
            if (!laukiantis) return;
            laukia.delete(id);
            if (klaida) laukiantis.reject(new Error(klaida));
            else laukiantis.resolve(poros);
        });
        // Gija, mirusi netikėtai, neturi pakabinti laukiančių skaitymų.
        w.on("error", (error) => {
            for (const [id, l] of laukia) {
                laukia.delete(id);
                l.reject(error);
            }
        });
        // Laisva gija neturi laikyti proceso gyvo; kol vyksta skaitymas –
        // priešingai, privalo (žr. `siusti`).
        w.unref();
        return w;
    });

    // Kiek skaitymų vyksta dabar. Gijos laikomos `unref`, kad neužlaikytų
    // proceso, bet tada laukiantis atsakymo procesas neturėtų event loop'e nė
    // vieno handle'o ir Node tyliai baigtų darbą viduryje skaitymo. Todėl
    // aktyvaus skaitymo metu gijos `ref`inamos.
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
            for (const w of workers) void w.terminate();
            laukia.clear();
        },
    };
}

/**
 * Pool'as konkrečiam failui+lentelei arba `null`, jei gijos išjungtos
 * (`SIDECAR_READ_THREADS=1`) ar bazės failo dar nėra — tada kviečiantysis
 * skaito pagrindinėje gijoje.
 */
export function gautiPoola({ dbPath, table, keyColumn }) {
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
        poolas = sukurtiPoola({ dbPath, table, keyColumn, gijos });
        poolai.set(cacheKey, poolas);
    }
    return poolas;
}

/** Sustabdo visas gijas; kviečiama iš `closeCompressedSqliteStores()`. */
export function uzdarytiPoolus() {
    for (const poolas of poolai.values()) poolas.close();
    poolai.clear();
}
