/*
Automatinis Regitros JTP parko duomenų atnaujinimas.
https://www.regitra.lt/imone/atviri-duomenys/

Regitra pilną parko nuotrauką skelbia kartą per mėnesį (per 10 darbo dienų nuo
mėnesio pradžios), todėl kas naktį siųstis 41 MB ZIP būtų perteklinis darbas.
Serveris grąžina `ETag` ir `Last-Modified`, tad naktinė patikra yra pigus HEAD —
siunčiama tik tada, kai failas iš tikrųjų pasikeitė. Parsiųsto ZIP md5 yra antra
apsauga tam atvejui, jei serveris pakeistų antraštes nepakeitęs turinio.

Kiekviena patikra įrašoma į `regitraAtnaujinimai`.

Rankinis paleidimas:
    npm run regitra:atnaujinti
    npm run regitra:atnaujinti -- --force     # praleisti etag/md5 patikrą
*/
import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("regitra", { operation: "atnaujintiRegitra" });
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
import { importuotiCsvIStaginga } from "./importRegitra.js";

const ZIP_URL =
    "https://www.regitra.lt/wp-content/uploads/failai/Atviri_JTP_parko_duomenys.zip";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// tmp/ yra gitignore'intas (`tmp/*`).
const DARBO_KATALOGAS = path.resolve(HERE, "../../tmp/regitra");
const ZIP_KELIAS = path.join(DARBO_KATALOGAS, "Atviri_JTP_parko_duomenys.zip");
const CSV_KELIAS = path.join(DARBO_KATALOGAS, "Atviri_JTP_parko_duomenys.csv");

/**
 * Paskutinis sėkmingai importuotas įrašas — su juo lyginamos HEAD antraštės.
 *
 * @returns {Promise<{etag: string|null, pakeitimoData: Date|null, zipMd5: string|null}|null>}
 */
async function paskutinisImportas() {
    const { rows } = await postgres.query(
        `SELECT "etag", "pakeitimoData", "zipMd5"
           FROM regitra."atnaujinimai"
          WHERE "busena" = 'importuota'
          ORDER BY "id" DESC
          LIMIT 1`,
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
    etag,
    pakeitimoData,
    dydis,
    zipMd5 = null,
    duomenuData = null,
    busena,
}) {
    const { rows } = await postgres.query(
        `INSERT INTO regitra."atnaujinimai"
             ("etag", "pakeitimoData", "dydis", "zipMd5", "duomenuData", "busena")
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING "id"`,
        [etag, pakeitimoData, dydis, zipMd5, duomenuData, busena],
    );
    return rows[0].id;
}

/**
 * Parsiunčia ZIP į `tmp/regitra/` ir tuo pačiu srautu suskaičiuoja jo md5.
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

/**
 * Perkelia staging duomenis į `regitra` ir `regitraMatymai`.
 *
 * Viskas vienoje trumpoje transakcijoje: sunkus darbas (516 tūkst. eilučių
 * parsinimas ir įterpimas) jau atliktas į staging lentelę, todėl rakinimas
 * trunka sekundes, o ne minutes — svetainės puslapiai neužstringa.
 *
 * @param {string} duomenuData - Nuotraukos data (YYYY-MM-DD).
 * @returns {Promise<{unikaliuSkaicius: number, naujuSkaicius: number}>}
 */
async function perkeltiIsStaginga(duomenuData) {
    const klientas = await postgres.connect();
    try {
        await klientas.query("BEGIN");

        // Tik naujos, dar nematytos eilutės. `regitra` yra append-only.
        const naujos = await klientas.query(
            `INSERT INTO regitra."priemoniuTipai"
             SELECT DISTINCT ON ("md5") * FROM regitra."importas"
             ON CONFLICT ("md5") DO NOTHING`,
        );

        // Istorija: kiekvienam md5 — kada pirmą/paskutinį kartą matytas, kiek
        // vienodų TP buvo šioje nuotraukoje ir keliose nuotraukose iš viso matyta.
        const matymai = await klientas.query(
            `INSERT INTO regitra."matymai"
                 ("md5", "pirmaMatytaData", "atnaujinimoData", "kiekis", "matymuSkaicius")
             SELECT "md5", $1::date, $1::date, count(*), 1
               FROM regitra."importas"
              GROUP BY "md5"
             ON CONFLICT ("md5") DO UPDATE SET
                 "atnaujinimoData" = EXCLUDED."atnaujinimoData",
                 "kiekis"          = EXCLUDED."kiekis",
                 "matymuSkaicius"  = regitra."matymai"."matymuSkaicius" + 1`,
            [duomenuData],
        );

        await klientas.query("COMMIT");
        return {
            unikaliuSkaicius: matymai.rowCount,
            naujuSkaicius: naujos.rowCount,
        };
    } catch (err) {
        await klientas.query("ROLLBACK");
        throw err;
    } finally {
        klientas.release();
    }
}

/** Tyliai ištrina laikiną failą. */
async function istrinti(kelias) {
    await fs.promises.rm(kelias, { force: true });
}

/**
 * Naktinis darbas: patikrina, ar Regitros failas pasikeitė, ir jei taip —
 * parsiunčia bei importuoja.
 *
 * @param {object} [options]
 * @param {boolean} [options.force=false] - Importuoti net jei failas nepasikeitęs.
 * @returns {Promise<{busena: string, naujuSkaicius?: number}>}
 */
export async function atnaujintiRegitrosDuomenis({ force = false } = {}) {
    const galva = await scrapeFetch(ZIP_URL, { method: "HEAD" });
    if (!galva.ok) {
        throw new Error(
            `Nepavyko patikrinti ZIP: HTTP ${galva.status} ${galva.statusText}`,
        );
    }

    const etag = galva.headers.get("etag");
    const lastModified = galva.headers.get("last-modified");
    const pakeitimoData = lastModified ? new Date(lastModified) : null;
    const skelbiamasDydis = Number(galva.headers.get("content-length")) || null;

    const ankstesnis = await paskutinisImportas();
    const nepakito =
        ankstesnis !== null &&
        etag !== null &&
        ankstesnis.etag === etag &&
        pakeitimoData !== null &&
        ankstesnis.pakeitimoData?.getTime() === pakeitimoData.getTime();

    if (nepakito && !force) {
        await irasytiPatikra({
            etag,
            pakeitimoData,
            dydis: skelbiamasDydis,
            busena: "nepakito",
        });
        log(`Regitros failas nepakito (${lastModified}) — nesiunčiama`);
        return { busena: "nepakito" };
    }

    // Nuotraukos data imama iš Last-Modified — tai realus duomenų aktualumas,
    // o ne mūsų importo laikas.
    const duomenuData = (pakeitimoData ?? new Date())
        .toISOString()
        .slice(0, 10);

    const patikrosId = await irasytiPatikra({
        etag,
        pakeitimoData,
        dydis: skelbiamasDydis,
        duomenuData,
        busena: "klaida", // pakeičiama į 'importuota' pabaigoje
    });

    try {
        await fs.promises.mkdir(DARBO_KATALOGAS, { recursive: true });

        log(`Siunčiamas Regitros ZIP (${lastModified})...`);
        const { md5: zipMd5, dydis } = await parsiustiZip(ZIP_URL, ZIP_KELIAS);
        log(`Parsiųsta ${dydis} baitų, md5 ${zipMd5}`);

        await postgres.query(
            `UPDATE regitra."atnaujinimai" SET "zipMd5" = $1, "dydis" = $2 WHERE "id" = $3`,
            [zipMd5, dydis, patikrosId],
        );

        // Antra apsauga: antraštės pasikeitė, bet turinys — ne.
        if (ankstesnis?.zipMd5 === zipMd5 && !force) {
            await postgres.query(
                `UPDATE regitra."atnaujinimai" SET "busena" = 'nepakito' WHERE "id" = $1`,
                [patikrosId],
            );
            await istrinti(ZIP_KELIAS);
            log("ZIP turinys nepakito (sutampa md5) — neimportuojama");
            return { busena: "nepakito" };
        }

        const { pavadinimas, dydis: csvDydis } = await isarchyvuotiPirmaIrasa(
            ZIP_KELIAS,
            CSV_KELIAS,
        );
        log(`Išpakuota ${pavadinimas} (${csvDydis} baitų)`);

        const { eiluciuSkaicius } = await importuotiCsvIStaginga(CSV_KELIAS);
        const { unikaliuSkaicius, naujuSkaicius } =
            await perkeltiIsStaginga(duomenuData);

        await postgres.query(
            `UPDATE regitra."atnaujinimai"
                SET "busena" = 'importuota',
                    "eiluciuSkaicius" = $1,
                    "unikaliuSkaicius" = $2,
                    "naujuSkaicius" = $3,
                    "importuotaData" = now()
              WHERE "id" = $4`,
            [eiluciuSkaicius, unikaliuSkaicius, naujuSkaicius, patikrosId],
        );

        await postgres.query(`TRUNCATE TABLE regitra."importas"`);
        await istrinti(ZIP_KELIAS);
        await istrinti(CSV_KELIAS);

        log(
            `Regitra atnaujinta (${duomenuData}): ${eiluciuSkaicius} eilučių, ` +
                `${unikaliuSkaicius} unikalių, ${naujuSkaicius} naujų`,
        );
        return { busena: "importuota", naujuSkaicius };
    } catch (err) {
        await postgres.query(
            `UPDATE regitra."atnaujinimai" SET "busena" = 'klaida', "klaida" = $1 WHERE "id" = $2`,
            [err.message, patikrosId],
        );
        throw err;
    }
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    const args = parseArgs(process.argv.slice(2));
    try {
        await atnaujintiRegitrosDuomenis({ force: args.force === true });
    } catch (err) {
        console.error("Klaida atnaujinant Regitros duomenis:", err);
        process.exitCode = 1;
    } finally {
        await postgres.end();
    }
}
