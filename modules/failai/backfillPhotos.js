import pLimit from "p-limit";
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import { readFailaiFs } from "./failaiFs.js";
import { matmenys, NUOTRAUKU_PLETINIAI } from "./photosLentele.js";

/*
Vienkartinis `files."photos"` užpildymas esamais failais.

  npm run failai:photos-backfill

Toliau lentelę šviežią palaiko pats nuskaitymas (žr. photosLentele.js), tad
šio skripto kasdien leisti nereikia. Jis idempotentinis — jei kada prireiktų
persiskaičiuoti, galima paleisti iš naujo.
*/

const logger = new Logger();
const FS_LYGIAGRECIAI = 32;
const PAKETAS = 1000;

/** Ta pati sąlyga, kaip atnaujintiFilesPhotos(), tik visai lentelei iš karto. */
async function kandidatai() {
    const { rows } = await postgres.query(
        `SELECT f.id, i."fileHash"
         FROM files."ocrStatus" o
         JOIN files.files f ON f.id = o.id
         JOIN files."extensions" e ON e.id = f."extensionId"
         LEFT JOIN files."dataExtraction" d ON d.id = f.id
         LEFT JOIN files."infoFiles" i ON i.id = f.id
         WHERE o.status = 1
           AND (d."wordCount" IS NULL OR d."wordCount" <= 10)
           AND lower(e.extension) = ANY($1::text[])`,
        [NUOTRAUKU_PLETINIAI],
    );
    return rows;
}

async function irasytiPaketa(eilutes) {
    if (!eilutes.length) return;
    await postgres.query(
        `INSERT INTO files."photos" (id, width, height)
         SELECT * FROM UNNEST($1::int[], $2::int[], $3::int[])
         ON CONFLICT (id) DO UPDATE SET
            width  = EXCLUDED.width,
            height = EXCLUDED.height`,
        [
            eilutes.map((r) => r.id),
            eilutes.map((r) => r.width),
            eilutes.map((r) => r.height),
        ],
    );
}

async function main() {
    logger.log("Renkami kandidatai...");
    const rows = await kandidatai();
    logger.log(`Rasta ${rows.length} nuotraukų.`);

    // Nebeatitinkantys išmetami — kad pakartotinis paleidimas lentelę suvienodintų.
    await postgres.query(
        `DELETE FROM files."photos" WHERE id <> ALL($1::int[])`,
        [rows.map((r) => r.id)],
    );

    const limit = pLimit(FS_LYGIAGRECIAI);
    let paketas = [];
    let irasyta = 0;

    // Matmenys guli FS turinio faile, tad kiekvienam kandidatui — po vieną nuskaitymą.
    await Promise.all(
        rows.map((r) =>
            limit(async () => {
                const turinys = r.fileHash ? await readFailaiFs(r.fileHash) : null;
                paketas.push({ id: r.id, ...matmenys(turinys?.metaduomenys) });

                if (paketas.length >= PAKETAS) {
                    const siunciamas = paketas;
                    paketas = [];
                    await irasytiPaketa(siunciamas);
                    irasyta += siunciamas.length;
                    logger.log(`Įrašyta ${irasyta}/${rows.length}`);
                }
            }),
        ),
    );

    await irasytiPaketa(paketas);
    irasyta += paketas.length;
    logger.log(`Baigta: ${irasyta} eilučių files."photos" lentelėje.`);
}

main()
    .catch((error) => {
        console.error("Nepavyko užpildyti files.photos:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await postgres.end();
    });
