import path from "node:path";
import config from "./config.js";

/*
Vienintelis sidecar SQLite bazių registras.

Vardas yra vienintelis identifikatorius — iš jo išvedamas ir failo kelias, ir
HTTP kelias, todėl naujas sidecar'as yra viena eilutė čia, o ne naujas ENV
kintamasis + naujas Astro route'as:

    failas(vardas) = <SIDECAR_DIR>/<vardas>.sqlite
    URL(vardas)    = <SIDECAR_REMOTE>/api/v1/sidecar/<vardas>?md5=<raktas>

Visos bazės guli viename plokščiame kataloge, bet kiekviena — atskiras failas.
SQLite turi vieną rašytoją visai bazei, o čia lygiagrečiai rašo skirtingi
procesai (OCR darbininkai, scraper'iai, eTar taskrunner); sujungus į vieną failą
jie rikiuotųsi eilėje prie to paties WAL.
*/

/**
 * `keyColumn` — istorinis skirtumas: bendrasis `createSidecarStore` rašo į
 * „hash" stulpelį, o eTar sidecar'as savo lentelę susikūrė su „md5" (tas pats
 * md5 hex, tik kitas vardas). Registre laikom abu, kad skaitymo kodas ir HTTP
 * route'as būtų vieni visiems.
 * @type {Record<string, { table: string, keyColumn: string }>}
 */
export const SIDECAR_DBS = {
    failaiInfo: { table: "failaiInfo", keyColumn: "hash" },
    dokumentai: { table: "dokumentai", keyColumn: "hash" },
    ocrRezultatai: { table: "ocrRezultatai", keyColumn: "hash" },
    liteko2: { table: "liteko2", keyColumn: "hash" },
    // TED skelbimų XML: `ted."tedNotices"` lieka tik metaduomenys.
    ted: { table: "ted", keyColumn: "hash" },
    // eTar rašomas ne per createSidecarStore, o tiesiai (modules/eTar/eTarSidecar.js).
    eTar: { table: "eTarAtsakymai", keyColumn: "md5" },
    // Atskiras failas, kad e-TAR ir e-Seimo rašytojai nekonkuruotų dėl vieno WAL.
    eSeimas: { table: "eSeimasAtsakymai", keyColumn: "md5" },
};

/** Ar toks sidecar'as apskritai egzistuoja (route'ų validacijai). */
export function isSidecarName(name) {
    return Object.hasOwn(SIDECAR_DBS, name);
}

function definition(name) {
    if (!isSidecarName(name)) throw new Error(`Nežinomas sidecar: ${name}`);
    return SIDECAR_DBS[name];
}

/** Lentelė, kurioje guli suspaustas turinys. */
export function sidecarTable(name) {
    return definition(name).table;
}

/** Pirminio rakto stulpelis toje lentelėje. */
export function sidecarKeyColumn(name) {
    return definition(name).keyColumn;
}

/**
 * `<SIDECAR_DIR>/<vardas>.sqlite` arba `null`, jei `SIDECAR_DIR` nenustatytas
 * (toks mazgas skaito tik per `SIDECAR_REMOTE`). Konfigūraciją skaitom kvietimo
 * metu, o ne importuojant — testai ją keičia.
 */
export function sidecarDbPath(name) {
    definition(name);
    const dir = config.sidecarDir;
    if (!dir) return null;
    return path.join(dir, `${name}.sqlite`);
}

/** Nuotolinio read endpoint'o URL arba `null`, jei `SIDECAR_REMOTE` nenustatytas. */
export function sidecarRemoteUrl(name, { batch = false } = {}) {
    definition(name);
    const base = config.sidecarRemote;
    if (!base) return null;
    return `${base.replace(/\/+$/, "")}/api/v1/sidecar/${name}${batch ? "/batch" : ""}`;
}

/** Kiek raktų priimam viena batch užklausa. */
export const SIDECAR_BATCH_LIMIT = 500;
