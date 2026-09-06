import { postgres } from "../../postgres/postgres.js";
import { isEiles } from "./nuskaitymoEile.js";
import { iOcrEile } from "./ocrEile.js";
import { atnaujintiFilesPhotos } from "./photosLentele.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

/*
Nuskaitymo rezultato įrašymas.

Rezultatas išsiskaido po kelias lenteles:
  files."dataExtraction"  versija, būsena, žodžiai/puslapiai/simboliai, nuskaitytojas
  files."infoFiles"       turinio raktas FS'e (fileHash)
  files."locations"       koordinatės (jų neturintiems eilutės nėra)
  files.files."authorId"  autorius per files."authors" žodyną
  files."ocrStatus"       ar failui rekomenduojamas OCR
  files."photos"          galerijos aibė (tik nuotraukoms; žr. photosLentele.js)

Versija ir klaidos kodas laikomi atskirai (`version` >= 0, `status` 0 arba klaida) —
senoje schemoje tai buvo viena perkrauta `failai.nuskaitytas` reikšmė.
*/

/** Klaidos kodai, kuriuos gali grąžinti nuskaitymas (žr. busena.js). */
export const NUSKAITYMO_KLAIDOS = [-1, -2, -4, -404];

/** Grąžina autoriaus id, sukurdamas žodyno įrašą, jei reikia. */
async function autoriausId(klientas, autorius) {
    if (!autorius) return null;
    const { rows } = await klientas.query(
        `INSERT INTO files."authors" (author) VALUES ($1)
         ON CONFLICT (author) DO UPDATE SET author = EXCLUDED.author
         RETURNING id`,
        [autorius],
    );
    return rows[0].id;
}

/**
 * Sėkmingas nuskaitymas — rezultatas rašomas į abi schemas ir failas išimamas
 * iš abiejų eilių.
 *
 * @param {Object} p
 * @param {number} p.id
 * @param {number} p.versija - nuskaitymo algoritmo versija
 * @param {number} p.wordCount
 * @param {number} p.pageCount
 * @param {number} p.characterCount
 * @param {number|null} p.ocrState - null = OCR nereikia, 0 = rekomenduojamas
 * @param {string|null} p.location - WKT POINT arba null
 * @param {string|null} p.autorius
 * @param {string} p.failasHash - sujungto FS turinio raktas
 * @param {number|null} [p.nodeId] - dokNuskaitytojai.id
 * @param {{width: number|null, height: number|null}} [p.dydis] - nuotraukos matmenys galerijai
 * @param {import("pg").ClientBase} [klientas]
 */
export async function pazymetiNuskaityta(
    {
        id,
        versija,
        wordCount,
        pageCount,
        characterCount,
        ocrState,
        location,
        autorius,
        failasHash,
        nodeId = null,
        dydis = {},
    },
    klientas = postgres,
) {
    await klientas.query(
        `INSERT INTO files."dataExtraction"
            (id, version, status, "nodeId", "wordCount", "pageCount", "characterCount", "extractedAt")
         VALUES ($1, $2, 0, $3, $4, $5, $6, NOW())
         ON CONFLICT (id) DO UPDATE SET
            version          = EXCLUDED.version,
            status           = 0,
            "nodeId"         = EXCLUDED."nodeId",
            "wordCount"      = EXCLUDED."wordCount",
            "pageCount"      = EXCLUDED."pageCount",
            "characterCount" = EXCLUDED."characterCount",
            "extractedAt"    = EXCLUDED."extractedAt"`,
        [id, versija, nodeId, wordCount, pageCount, characterCount],
    );

    await klientas.query(
        `INSERT INTO files."infoFiles" (id, "fileHash")
         VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET "fileHash" = EXCLUDED."fileHash"`,
        [id, failasHash],
    );

    const authorId = await autoriausId(klientas, autorius);
    if (authorId) {
        await klientas.query(
            `UPDATE files.files SET "authorId" = $1 WHERE id = $2`,
            [authorId, id],
        );
    }

    // Koordinatės — atskiroje lentelėje; jų neturintiems eilutės nekuriam,
    // o dingusias (pvz. pakartotinai nuskaičius) pašalinam.
    if (location) {
        await klientas.query(
            `INSERT INTO files."locations" (id, location)
             VALUES ($1, ST_GeomFromText($2, 4326))
             ON CONFLICT (id) DO UPDATE SET location = EXCLUDED.location`,
            [id, location],
        );
    } else {
        await klientas.query(`DELETE FROM files."locations" WHERE id = $1`, [id]);
    }

    // OCR būsena: nuskaitymas nusprendžia, ar failui OCR rekomenduojamas.
    if (ocrState !== null && ocrState !== undefined) {
        await klientas.query(
            `INSERT INTO files."ocrStatus" (id, status)
             VALUES ($1, $2)
             ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status`,
            [id, ocrState],
        );
    }

    // OCR eilę pildo kodas. Tinkamumą sprendžia pati užklausa.
    await iOcrEile([id], klientas);

    // Galerijos aibė — čia paaiškėja galutinis wordCount, tad failas arba įrašomas,
    // arba (jei pernuskaičius atsirado žodžių) išimamas.
    await atnaujintiFilesPhotos(id, dydis, klientas);

    // Pradinis files INSERT gali būti suprojektuotas dar prieš parsisiuntimą ir
    // teksto išgavimą. Baigtas nuskaitymas todėl visada sukuria naują patch
    // darbą dokumentų projekcijai.
    await klientas.query(
        `INSERT INTO files."documentsQueue" ("fileId", change)
         VALUES ($1, 'patch')`,
        [id],
    );

    await isEiles([id], klientas);

    if (klientas === postgres) {
        signalWork(WORK_SIGNALS.FILES_DOCUMENTS_READY, {
            source: "pazymetiNuskaityta",
            count: 1,
        });
    }
}

/**
 * Pažymi failus kaip nenuskaitytus („nuskaityk iš naujo").
 *
 * Be šito `iEile` sąlyga (`version < NUSKAITYMO_VERSIJA`) nebūtų įvykdyta ir failas
 * į `files."extractionQueue"` nepatektų. Kviečiama po OCR (ocr/submit.ts) ir rankiniu
 * pakartojimu (nuskaitytiPakartotinai.js).
 *
 * @param {number[]} failuId
 * @param {import("pg").ClientBase} [klientas]
 */
export async function atstatytiNuskaityma(failuId, klientas = postgres) {
    if (!failuId?.length) return;

    await klientas.query(
        `UPDATE files."dataExtraction"
         SET version = 0, status = 0
         WHERE id = ANY($1::int[])`,
        [failuId],
    );
}

/**
 * Nepavykęs nuskaitymas — klaidos kodas į `files."dataExtraction".status`.
 * Eilės bandymus tvarko pazymetiNuskaitymoBandyma (nuskaitymoEile.js).
 *
 * @param {number} id
 * @param {number} kodas - -1, -2, -4 arba -404
 * @param {import("pg").ClientBase} [klientas]
 */
export async function pazymetiNuskaitymoKlaida(id, kodas, klientas = postgres) {
    await klientas.query(
        `INSERT INTO files."dataExtraction" (id, version, status, "extractedAt")
         VALUES ($1, 0, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET
            status        = EXCLUDED.status,
            "extractedAt" = EXCLUDED."extractedAt"`,
        [id, kodas],
    );
}
