/*
Priemonių nuskaitymas: sąrašo puslapyje yra visos ~263 priemonės, o kiekvienos
puslapyje – jos id (toks pat kaip sąrašo filtre), Nr., skiriamos lėšos ir
aprašomieji laukai.

Priemonės pavadinimas nėra unikalus, tad projektai su jomis siejami per `slug`,
kurį duoda būtent šis nuskaitymas (projekto puslapyje yra tik nuoroda).
*/

import pLimit from "p-limit";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { parsisiustiHtml, priemoniuSarasoUrl, priemonesUrl } from "./saltinis.js";
import { parsePriemoniuSarasa, parsePriemonesPuslapi } from "./parsePriemone.js";

const SCHEMA = `"2014esInvesticijos"`;
const LYGIAGRECIAI = 4;

/**
 * @param {string} slug
 * @param {ReturnType<typeof parsePriemonesPuslapi>} p
 * @returns {Promise<void>}
 */
async function irasytiPriemone(slug, p) {
    await postgres.query(
        `INSERT INTO ${SCHEMA}."priemones"
         ("id", "pavadinimas", "slug", "kodas", "esLesos", "visosLesos",
          "finansavimoForma", "atrankosBudas", "galimiPareiskejai",
          "finansuojamosVeiklos", "atnaujinimoData", "nuskaityta")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
         ON CONFLICT ("id") DO UPDATE SET
             "pavadinimas" = EXCLUDED."pavadinimas",
             "slug" = EXCLUDED."slug",
             "kodas" = EXCLUDED."kodas",
             "esLesos" = EXCLUDED."esLesos",
             "visosLesos" = EXCLUDED."visosLesos",
             "finansavimoForma" = EXCLUDED."finansavimoForma",
             "atrankosBudas" = EXCLUDED."atrankosBudas",
             "galimiPareiskejai" = EXCLUDED."galimiPareiskejai",
             "finansuojamosVeiklos" = EXCLUDED."finansuojamosVeiklos",
             "atnaujinimoData" = EXCLUDED."atnaujinimoData",
             "nuskaityta" = now()`,
        [
            p.saltinioId,
            p.pavadinimas,
            slug,
            p.kodas,
            p.esLesos,
            p.visosLesos,
            p.finansavimoForma,
            p.atrankosBudas,
            p.galimiPareiskejai,
            p.finansuojamosVeiklos,
            p.atnaujinimoData,
        ],
    );
}

/**
 * Priemonių slug'ai, kurių dar nėra DB.
 * @param {string[]} slugai
 * @returns {Promise<string[]>}
 */
async function tikNauji(slugai) {
    const { rows } = await postgres.query(
        `SELECT "slug" FROM ${SCHEMA}."priemones" WHERE "slug" = ANY($1::text[])`,
        [slugai],
    );
    const turimi = new Set(rows.map((r) => r.slug));
    return slugai.filter((slug) => !turimi.has(slug));
}

/**
 * Nuskaito priemonių puslapius.
 * @param {{visas?: boolean}} [nustatymai] visas – perrašyti ir jau turimas
 * @returns {Promise<number>} Kiek priemonių įrašyta
 */
export async function nuskaitytiPriemones({ visas = false } = {}) {
    const sarasas = parsePriemoniuSarasa(await parsisiustiHtml(priemoniuSarasoUrl()));
    log(`Priemonių sąraše: ${sarasas.length}`);

    const slugai = visas ? sarasas : await tikNauji(sarasas);
    if (slugai.length === 0) return 0;

    const limit = pLimit(LYGIAGRECIAI);
    let nuskaityta = 0;

    await Promise.all(
        slugai.map((slug) =>
            limit(async () => {
                try {
                    const priemone = parsePriemonesPuslapi(await parsisiustiHtml(priemonesUrl(slug)));
                    if (!priemone.saltinioId) {
                        log(`Priemonė be id: ${slug}`);
                        return;
                    }
                    await irasytiPriemone(slug, priemone);
                    nuskaityta += 1;
                } catch (err) {
                    log(`Klaida nuskaitant priemonę ${slug}: ${err.message}`);
                }
            }),
        ),
    );

    log(`Nuskaityta priemonių: ${nuskaityta}/${slugai.length}`);
    return nuskaityta;
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    await nuskaitytiPriemones({ visas: process.argv.includes("--visas") });
    await postgres.end();
}
