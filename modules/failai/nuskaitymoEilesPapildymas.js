/*
Suvienodina filesExtractionQueue su files lentele.

Eilę įprastai pildo kodas (žr. nuskaitymoEile.js), tad šitas scriptas reikalingas tada, kai failai
buvo pakeisti aplenkiant tuos taškus:
  - pakelta NUSKAITYMO_VERSIJA (visus failus reikia nuskaityti iš naujo),
  - rankinės DB korekcijos,
  - pataisytiExtension.js pakeitė plėtinį.

  npm run failai:nuskaitymo-eile              -- tik prideda trūkstamus
  npm run failai:nuskaitymo-eile -- --valyti  -- dar ir ištrina nebereikalingus
*/

import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import { iEile, NUSKAITYMO_PLETINIAI, NUSKAITYMO_VERSIJA } from "./nuskaitymoEile.js";
const logger = new Logger();

const BATCH = 10_000;

/**
 * Prideda į eilę visus failus, kuriuos reikia nuskaityti, bet kurių eilėje nėra.
 * @returns {Promise<number>} kiek pridėta
 */
export async function papildytiEile() {
    let paskutinisId = 0;
    let prideta = 0;

    for (;;) {
        const { rows } = await postgres.query(
            `SELECT id FROM public.files
             WHERE id > $1
             ORDER BY id
             LIMIT $2`,
            [paskutinisId, BATCH],
        );

        if (!rows.length) break;

        paskutinisId = rows[rows.length - 1].id;
        const batchePrideta = await iEile(rows.map((r) => r.id));
        prideta += batchePrideta;

        if (batchePrideta) {
            logger.log(`Pridėta ${prideta} (id iki ${paskutinisId})`);
        }
    }

    return prideta;
}

/**
 * Ištrina iš eilės failus, kurių nuskaityti nebereikia.
 * @returns {Promise<number>} kiek ištrinta
 */
export async function isvalytiEile() {
    const res = await postgres.query(
        `DELETE FROM public."filesExtractionQueue" q
         USING public.files f
         LEFT JOIN public."filesExtensions" e ON e.id = f."extensionId"
         LEFT JOIN public."filesDataExtraction" d ON d.id = f.id
         WHERE f.id = q.id
           AND q."lockedBy" IS NULL
           AND (
               f."downloadStatus" NOT IN (1, -5)
               OR LOWER(e.extension) <> ALL($1::text[])
               OR COALESCE(d.version, 0) >= $2
           )`,
        [NUSKAITYMO_PLETINIAI, NUSKAITYMO_VERSIJA],
    );

    return res.rowCount;
}

// jei vykdomas tiesiogiai
if (import.meta.url === `file://${process.argv[1]}`) {
    const valyti = process.argv.includes("--valyti");

    if (valyti) {
        logger.log(`Iš eilės ištrinta ${await isvalytiEile()} nebereikalingų failų`);
    }

    logger.log(`Į eilę pridėta ${await papildytiEile()} failų (versija ${NUSKAITYMO_VERSIJA})`);

    await postgres.end();
}
