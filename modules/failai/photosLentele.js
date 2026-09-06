import { postgres } from "../../postgres/postgres.js";

/*
`files."photos"` — galerijai (/failai/galerija) tinkamų nuotraukų aibė.

Dokumento skenas ar dokumento nuotrauka turi žodžių, tad `wordCount <= 10` sąlyga
juos atmeta — lentelėje lieka tik realios nuotraukos. Aibė palaikoma šviežia iš
dviejų taškų, kur rašomi sąlygos dėmenys:

  nuskaitymoRezultatas.js  pazymetiNuskaityta()   — wordCount + matmenys
  ocrEile.js               pazymetiOcrRezultata() — files."ocrStatus".status = 1

Vienkartiniam esamų failų sukėlimui — backfillPhotos.js.
*/

/** Plėtiniai, kuriuos galerija laiko nuotraukomis. */
export const NUOTRAUKU_PLETINIAI = [
    "jpg",
    "jpeg",
    "png",
    "bmp",
    "gif",
    "webp",
    "heic",
];

/**
 * Matmenys iš nuskaitymo metaduomenų — pravalyti taip, kad tiktų CSS aspect-ratio.
 * Netikę (per maži, per dideli, per siauri) atmetami, kad galerijoje neatsirastų
 * ištemptų kortelių; tokiems šablonas naudoja 4/3.
 *
 * @param {Object|null|undefined} metaduomenys
 * @returns {{ width: number|null, height: number|null }}
 */
export function matmenys(metaduomenys) {
    const w = metaduomenys?.width || metaduomenys?.exif?.["Image Width"]?.value;
    const h = metaduomenys?.height || metaduomenys?.exif?.["Image Height"]?.value;
    const tinka =
        w > 10 && h > 10 && w < 20000 && h < 20000 && h / w < 2 && w / h < 10;
    return tinka ? { width: w, height: h } : { width: null, height: null };
}

/**
 * Įrašo failą į `files."photos"` arba pašalina, jei jis (nebe)atitinka galerijos
 * sąlygos. Visi lookup'ai eina per PK, tad kaina nuskaitymo kelyje nereikšminga.
 *
 * Matmenys nebūtini: OCR kelias jų neturi, juos užpildo po OCR sekantis
 * pakartotinis nuskaitymas, tad esami stulpeliai per COALESCE neužtrinami.
 *
 * @param {number} id
 * @param {{ width?: number|null, height?: number|null }} [dydis]
 * @param {import("pg").ClientBase} [klientas]
 */
export async function atnaujintiFilesPhotos(id, dydis = {}, klientas = postgres) {
    const { rowCount } = await klientas.query(
        `INSERT INTO files."photos" (id, width, height)
         SELECT f.id, $2, $3
         FROM files.files f
         JOIN files."ocrStatus" o ON o.id = f.id
         JOIN files."extensions" e ON e.id = f."extensionId"
         LEFT JOIN files."dataExtraction" d ON d.id = f.id
         WHERE f.id = $1
           AND o.status = 1
           AND (d."wordCount" IS NULL OR d."wordCount" <= 10)
           AND lower(e.extension) = ANY($4::text[])
         ON CONFLICT (id) DO UPDATE SET
            width  = COALESCE(EXCLUDED.width,  files."photos".width),
            height = COALESCE(EXCLUDED.height, files."photos".height)`,
        [id, dydis.width ?? null, dydis.height ?? null, NUOTRAUKU_PLETINIAI],
    );

    // Nieko neįrašyta — failas sąlygos neatitinka (pvz. pernuskaičius atsirado
    // žodžių), tad iš lentelės išimamas.
    if (rowCount === 0) {
        await klientas.query(`DELETE FROM files."photos" WHERE id = $1`, [id]);
    }
}
