/*
Automatinis Sodros mėnesinių duomenų atnaujinimas.
https://atvira.sodra.lt/imones/rinkiniai/index.html

Sodra kiekvienų metų duomenis skelbia viename kaupiamajame faile
(`.../downloads/2026/monthly-2026.csv.zip`), kuris papildomas maždaug kartą per
mėnesį — naujas mėnuo prirašomas prie tų pačių metų failo. Todėl kas naktį
tikrinami einamųjų metų duomenys, o sausį–kovą papildomai ir praėjusių metų:
gruodžio duomenys į praėjusių metų failą įrašomi jau naujiems metams prasidėjus.

Kadangi failas keičiasi retai, naktinė patikra yra pigus HEAD — siunčiama tik tada,
kai pasikeičia `Last-Modified` / `ETag` / dydis. Parsiųsto ZIP md5 yra antra apsauga
tam atvejui, jei serveris pakeistų antraštes nepakeitęs turinio.

Kiekviena patikra įrašoma į `sodra."atnaujinimai"` (DDL — sodraSchema.sql).

Rankinis paleidimas:
    npm run sodra:atnaujinti
    npm run sodra:atnaujinti -- --force            # praleisti antraščių/md5 patikrą
    npm run sodra:atnaujinti -- --metai 2019       # konkretūs metai (galima kartoti per kablelį)
*/
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("sodra", { operation: "atnaujintiSodra" });
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { parseArgs } from "../../utils/cliArgs.js";
import { isarchyvuotiPirmaIrasa } from "../../utils/isarchyvuotiZip.js";
import { importuotiSodrosCsv } from "./importSodra.js";
import { syncJuridiniaiDictionaries } from "../juridiniai/syncDictionaries.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// tmp/ yra gitignore'intas (`tmp/*`).
const DARBO_KATALOGAS = path.resolve(HERE, "../../tmp/sodra");

// Mėnuo (1–12), iki kurio imtinai kartu tikrinami ir praėjusių metų duomenys.
const PRAEITU_METU_TIKRINIMO_RIBA = 3;

/** @param {number} metai */
const zipUrl = (metai) =>
    `https://atvira.sodra.lt/imones/downloads/${metai}/monthly-${metai}.csv.zip`;

/** @param {number} metai */
const csvVardas = (metai) => `monthly-${metai}.csv`;

/**
 * Kurių metų failus tikrinti šiandien.
 *
 * @param {Date} [dabar]
 * @returns {number[]}
 */
export function tikrinamiMetai(dabar = new Date()) {
    const metai = dabar.getFullYear();
    const menuo = dabar.getMonth() + 1;
    return menuo <= PRAEITU_METU_TIKRINIMO_RIBA ? [metai, metai - 1] : [metai];
}

/**
 * Paskutinis sėkmingai importuotas tų metų įrašas — su juo lyginamos HEAD antraštės.
 *
 * @param {number} metai
 * @returns {Promise<{etag: string|null, pakeitimoData: Date|null, dydis: string|null, zipMd5: string|null}|null>}
 */
async function paskutinisImportas(metai) {
    const { rows } = await postgres.query(
        `SELECT "etag", "pakeitimoData", "dydis", "zipMd5"
           FROM sodra."atnaujinimai"
          WHERE "busena" = 'importuota' AND "metai" = $1
          ORDER BY "id" DESC
          LIMIT 1`,
        [metai],
    );
    return rows[0] ?? null;
}

/**
 * Užregistruoja patikrą. Grąžina įrašo id, kad vėliau būtų galima jį papildyti.
 *
 * @param {object} laukai
 * @returns {Promise<number>}
 */
async function irasytiPatikra({
    metai,
    failoVardas,
    etag,
    pakeitimoData,
    dydis,
    zipMd5 = null,
    busena,
}) {
    const { rows } = await postgres.query(
        `INSERT INTO sodra."atnaujinimai"
             ("metai", "failoVardas", "etag", "pakeitimoData", "dydis", "zipMd5", "busena")
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING "id"`,
        [metai, failoVardas, etag, pakeitimoData, dydis, zipMd5, busena],
    );
    return rows[0].id;
}

/**
 * Parsiunčia ZIP į `tmp/sodra/` ir tuo pačiu srautu suskaičiuoja jo md5.
 *
 * @param {string} url
 * @param {string} kelias
 * @returns {Promise<{md5: string, dydis: number}>}
 */
async function parsiustiZip(url, kelias) {
    const atsakymas = await scrapeFetch(url);
    if (!atsakymas.ok || !atsakymas.body) {
        throw new Error(
            `Nepavyko parsiųsti ZIP: HTTP ${atsakymas.status} ${atsakymas.statusText}`,
        );
    }

    const hash = createHash("md5");
    const skaiciuotojas = new Transform({
        transform(chunk, _enc, cb) {
            hash.update(chunk);
            cb(null, chunk);
        },
    });

    await pipeline(atsakymas.body, skaiciuotojas, fs.createWriteStream(kelias));

    const { size } = await fs.promises.stat(kelias);
    return { md5: hash.digest("hex"), dydis: size };
}

/** Tyliai ištrina laikiną failą. */
async function istrinti(kelias) {
    await fs.promises.rm(kelias, { force: true });
}

/**
 * Patikrina ir, jei reikia, parsiunčia bei importuoja vienų metų Sodros failą.
 *
 * @param {number} metai
 * @param {object} [options]
 * @param {boolean} [options.force=false]
 * @returns {Promise<{metai: number, busena: string, eiluciuSkaicius?: number, naujausiasMenuo?: string|null}>}
 */
export async function atnaujintiSodrosMetus(metai, { force = false } = {}) {
    const url = zipUrl(metai);
    const failoVardas = csvVardas(metai);
    const zipKelias = path.join(DARBO_KATALOGAS, `${failoVardas}.zip`);
    const csvKelias = path.join(DARBO_KATALOGAS, failoVardas);

    const galva = await scrapeFetch(url, { method: "HEAD" });
    if (galva.status === 404) {
        // Sausio pradžioje naujų metų failo dar nebūna — tai ne klaida.
        await irasytiPatikra({
            metai,
            failoVardas,
            etag: null,
            pakeitimoData: null,
            dydis: null,
            busena: "nera",
        });
        log(`Sodros ${failoVardas} dar nepaskelbtas (HTTP 404)`);
        return { metai, busena: "nera" };
    }
    if (!galva.ok) {
        throw new Error(
            `Nepavyko patikrinti ${failoVardas}: HTTP ${galva.status} ${galva.statusText}`,
        );
    }

    const etag = galva.headers.get("etag");
    const lastModified = galva.headers.get("last-modified");
    const pakeitimoData = lastModified ? new Date(lastModified) : null;
    const skelbiamasDydis = Number(galva.headers.get("content-length")) || null;

    const ankstesnis = await paskutinisImportas(metai);
    // Sodros serveris ETag negrąžina, tad pagrindinis požymis yra Last-Modified;
    // dydis prisideda kaip papildoma apsauga. ETag lyginam tik jei jis yra.
    const nepakito =
        ankstesnis !== null &&
        pakeitimoData !== null &&
        ankstesnis.pakeitimoData?.getTime() === pakeitimoData.getTime() &&
        (etag === null || ankstesnis.etag === etag) &&
        (skelbiamasDydis === null ||
            ankstesnis.dydis === null ||
            Number(ankstesnis.dydis) === skelbiamasDydis);

    if (nepakito && !force) {
        await irasytiPatikra({
            metai,
            failoVardas,
            etag,
            pakeitimoData,
            dydis: skelbiamasDydis,
            busena: "nepakito",
        });
        log(`Sodros ${failoVardas} nepakito (${lastModified}) — nesiunčiama`);
        return { metai, busena: "nepakito" };
    }

    const patikrosId = await irasytiPatikra({
        metai,
        failoVardas,
        etag,
        pakeitimoData,
        dydis: skelbiamasDydis,
        busena: "klaida", // pakeičiama į 'importuota' pabaigoje
    });

    try {
        await fs.promises.mkdir(DARBO_KATALOGAS, { recursive: true });

        log(`Siunčiamas Sodros ${failoVardas}.zip (${lastModified})...`);
        const { md5: zipMd5, dydis } = await parsiustiZip(url, zipKelias);
        log(`Parsiųsta ${dydis} baitų, md5 ${zipMd5}`);

        await postgres.query(
            `UPDATE sodra."atnaujinimai" SET "zipMd5" = $1, "dydis" = $2 WHERE "id" = $3`,
            [zipMd5, dydis, patikrosId],
        );

        // Antra apsauga: antraštės pasikeitė, bet turinys — ne.
        if (ankstesnis?.zipMd5 === zipMd5 && !force) {
            await postgres.query(
                `UPDATE sodra."atnaujinimai" SET "busena" = 'nepakito' WHERE "id" = $1`,
                [patikrosId],
            );
            await istrinti(zipKelias);
            log(`${failoVardas} turinys nepakito (sutampa md5) — neimportuojama`);
            return { metai, busena: "nepakito" };
        }

        const { pavadinimas, dydis: csvDydis } = await isarchyvuotiPirmaIrasa(
            zipKelias,
            csvKelias,
        );
        log(`Išpakuota ${pavadinimas} (${csvDydis} baitų)`);

        // Importo vardas — visada `monthly-<metai>.csv`, kad kartotiniai to paties
        // failo importai liktų prie to paties `sodra."importai"` įrašo.
        const { eiluciuSkaicius, praleista, irasyta, naujausiasMenuo } =
            await importuotiSodrosCsv(csvKelias, { importFile: failoVardas });

        await postgres.query(
            `UPDATE sodra."atnaujinimai"
                SET "busena" = 'importuota',
                    "eiluciuSkaicius" = $1,
                    "praleistaSkaicius" = $2,
                    "irasytaSkaicius" = $3,
                    "naujausiasMenuo" = $4,
                    "importuotaData" = now()
              WHERE "id" = $5`,
            [eiluciuSkaicius, praleista, irasyta, naujausiasMenuo, patikrosId],
        );

        await istrinti(zipKelias);
        await istrinti(csvKelias);

        log(
            `Sodra ${metai} atnaujinta: ${eiluciuSkaicius} eilučių, ` +
                `${irasyta} įrašyta, naujausias mėnuo ${naujausiasMenuo}`,
        );
        return { metai, busena: "importuota", eiluciuSkaicius, naujausiasMenuo };
    } catch (err) {
        await postgres.query(
            `UPDATE sodra."atnaujinimai" SET "busena" = 'klaida', "klaida" = $1 WHERE "id" = $2`,
            [err.message, patikrosId],
        );
        await istrinti(zipKelias);
        await istrinti(csvKelias);
        throw err;
    }
}

/**
 * Naktinis darbas: patikrina einamųjų (o sausį–kovą ir praėjusių) metų failus.
 *
 * Metai apdorojami nuosekliai — kiekvienas importas yra ~700 tūkst. eilučių upsert'ų,
 * tad du iš karto tik konkuruotų dėl to paties DB pool'o.
 *
 * @param {object} [options]
 * @param {boolean} [options.force=false] - Importuoti net jei failas nepasikeitęs.
 * @param {number[]} [options.metai] - Konkretūs metai vietoj automatinio pasirinkimo.
 * @returns {Promise<Array<{metai: number, busena: string}>>}
 */
export async function atnaujintiSodrosDuomenis({ force = false, metai } = {}) {
    const metaiSarasas = metai?.length ? metai : tikrinamiMetai();
    const rezultatai = [];
    const klaidos = [];

    for (const vieneriMetai of metaiSarasas) {
        try {
            rezultatai.push(
                await atnaujintiSodrosMetus(vieneriMetai, { force }),
            );
        } catch (err) {
            // Vienų metų nesėkmė neturi sustabdyti kitų — klaidas metam pabaigoje.
            console.error(`Klaida atnaujinant Sodros ${vieneriMetai} m.:`, err);
            rezultatai.push({ metai: vieneriMetai, busena: "klaida" });
            klaidos.push(`${vieneriMetai}: ${err.message}`);
        }
    }

    if (klaidos.length) {
        throw new Error(`Nepavyko atnaujinti Sodros duomenų — ${klaidos.join("; ")}`);
    }

    if (rezultatai.some((result) => result.busena === "importuota")) {
        await syncJuridiniaiDictionaries(postgres, "sodra-dictionaries");
        signalWork(WORK_SIGNALS.JURIDINIAI_REFRESH_READY, { source: "sodra" });
    }

    return rezultatai;
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const args = parseArgs(process.argv.slice(2));
    const metai =
        typeof args.metai === "string"
            ? args.metai
                  .split(",")
                  .map((m) => Number(m.trim()))
                  .filter((m) => Number.isInteger(m))
            : undefined;

    try {
        await atnaujintiSodrosDuomenis({ force: args.force === true, metai });
    } catch (err) {
        console.error("Klaida atnaujinant Sodros duomenis:", err);
        process.exitCode = 1;
    } finally {
        await postgres.end();
    }
}
