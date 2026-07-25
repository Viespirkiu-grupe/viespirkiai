import { postgres } from "../../postgres/postgres.js";
import { FILES_JOINS, FILES_SELECT, papildytiFaila } from "./filesSkaitymas.js";

/*
Failų nuskaitymo eilė — `filesExtractionQueue`.

Eilėje laikomi tik neatlikti darbai: reikia nuskaityti — eilutė yra, nebereikia — eilutės nėra.
Būsena (versija, klaidos kodas) gyvena `filesDataExtraction`, o eilė saugo tik tai, ko ta
lentelė nežino: bandymų skaičių, atidėjimą ir rezervaciją.

Eilę pildo kodas (ne DB trigeris) tuose taškuose, kur failas tampa nuskaitomu:
  - parsisiuntus (parsiusti.js, downloadStatus = 1),
  - išskleidus iš archyvo (nuskaitytiTeksta.js, downloadStatus = -5),
  - po OCR (failas/ocr/submit.ts, versija nulinama),
  - rankiniu pakartojimu (nuskaitytiPakartotinai.js).
Praleistus atvejus (rankinės DB korekcijos, pataisytiExtension.js, NUSKAITYMO_VERSIJA pakėlimas)
sutvarko nuskaitymoEilesPapildymas.js.
*/

// Nuskaitymo logikos versija — pakėlus, failai nuskaitomi iš naujo.
// Pakėlus reikia paleisti `npm run failai:nuskaitymo-eile` ir perkrauti workerius.
export const NUSKAITYMO_VERSIJA = 12;

// Kiek kartų bandoma nuskaityti failą prieš pašalinant jį iš eilės.
export const NUSKAITYMO_BANDYMAI = 5;

// Plėtiniai, kuriuos moka nuskaityti dokNuskaitytojai.
export const NUSKAITYMO_PLETINIAI = [
    "pdf", "prn", "docx", "odt", "docm", "dotx", "doc", "dot", "rtf", "pages",
    "xlsx", "xlsm", "xlsb", "xls", "csv", "pptx", "ppsx", "ppt",
    "zip", "adoc", "bdoc", "edoc", "txt", "url", "msg", "eml", "7z", "jpg", "jpeg", "rar",
    "png", "tif", "tiff", "odg", "pub",
];

/**
 * Įdeda failus į nuskaitymo eilę. Tinkamumą tikrina pati užklausa, tad kviečiantiesiems
 * nereikia žinoti eilės taisyklių — galima paduoti bet kokius id.
 * Jau esančių eilutių neliečia (nenumuša bandymų skaitiklio ar rezervacijos).
 * @param {number[]} failuId
 * @param {import("pg").ClientBase} [klientas] - tranzakcijos klientas, jei reikia
 * @returns {Promise<number>} kiek eilučių pridėta
 */
export async function iEile(failuId, klientas = postgres) {
    if (!failuId?.length) return 0;

    // Sąlyga: parsiųsta arba iš archyvo, tinkamas plėtinys, nuskaitymo versija
    // senesnė už dabartinę (dar nenuskaitytų versija — 0).
    const res = await klientas.query(
        `INSERT INTO public."filesExtractionQueue" (id)
         SELECT f.id
         FROM public.files f
         LEFT JOIN public."filesExtensions" e ON e.id = f."extensionId"
         LEFT JOIN public."filesDataExtraction" d ON d.id = f.id
         WHERE f.id = ANY($1::int[])
           AND f."downloadStatus" IN (1, -5)
           AND LOWER(e.extension) = ANY($2::text[])
           AND COALESCE(d.version, 0) < $3
         ON CONFLICT (id) DO NOTHING`,
        [failuId, NUSKAITYMO_PLETINIAI, NUSKAITYMO_VERSIJA],
    );

    return res.rowCount;
}

/**
 * Pašalina failus iš nuskaitymo eilės (darbas atliktas arba nebereikalingas).
 * @param {number[]} failuId
 * @param {import("pg").ClientBase} [klientas] - tranzakcijos klientas, jei reikia
 * @returns {Promise<number>} kiek eilučių ištrinta
 */
export async function isEiles(failuId, klientas = postgres) {
    if (!failuId?.length) return 0;

    const res = await klientas.query(
        `DELETE FROM public."filesExtractionQueue" WHERE id = ANY($1::int[])`,
        [failuId],
    );

    return res.rowCount;
}

/**
 * Paima vieną failą nuskaitymui ir uždeda rezervaciją.
 *
 * @param {string} nodeName
 * @param {number|null} [failasId] - konkretus failas (CLI), aplenkiant eiliškumą
 * @param {import("pg").ClientBase} [klientas]
 * @returns {Promise<Object|null>} failo eilutė senuoju pavidalu arba null
 */
export async function paimtiNuskaitymui(nodeName, failasId = null, klientas = postgres) {
    if (failasId) {
        const { rows } = await klientas.query(
            `WITH locked AS (
                UPDATE public."filesExtractionQueue" q
                SET "lockedBy" = $1, "lockedAt" = NOW()
                WHERE q.id = $2 AND q."lockedBy" IS NULL
                RETURNING q.id
            )
            SELECT ${FILES_SELECT}
            FROM public.files f
            ${FILES_JOINS}
            WHERE f.id = (SELECT id FROM locked)`,
            [nodeName, failasId],
        );
        return papildytiFaila(rows[0] ?? null);
    }

    const { rows } = await klientas.query(
        // Nebandyti failai (attempts = 0, nextAttempt NULL) imami pirma, naujesni
        // pirmiau; klaidos — tik atėjus jų atidėjimo laikui.
        `WITH cte AS (
            SELECT q.id FROM public."filesExtractionQueue" q
            WHERE q."lockedBy" IS NULL
              AND q.attempts < $2
              AND (q."nextAttempt" IS NULL OR q."nextAttempt" <= NOW())
            ORDER BY q.attempts, q."nextAttempt" NULLS FIRST, q.id DESC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        ),
        locked AS (
            UPDATE public."filesExtractionQueue" q
            SET "lockedBy" = $1, "lockedAt" = NOW()
            FROM cte WHERE q.id = cte.id
            RETURNING q.id
        )
        SELECT ${FILES_SELECT}
        FROM public.files f
        ${FILES_JOINS}
        WHERE f.id = (SELECT id FROM locked)`,
        [nodeName, NUSKAITYMO_BANDYMAI],
    );

    return papildytiFaila(rows[0] ?? null);
}

/**
 * Nepavykęs nuskaitymas: užskaitomas bandymas, uždedamas eksponentinis
 * atidėjimas, o viršijus ribą eilutė pašalinama.
 * @param {number} id
 * @param {import("pg").ClientBase} [klientas]
 */
export async function pazymetiNuskaitymoBandyma(id, klientas = postgres) {
    await klientas.query(
        `WITH bumped AS (
            UPDATE public."filesExtractionQueue"
            SET attempts = attempts + 1,
                "nextAttempt" = NOW() + LEAST(
                    INTERVAL '1 day',
                    INTERVAL '5 minutes' * POWER(2, attempts)
                ),
                "lockedBy" = NULL,
                "lockedAt" = NULL
            WHERE id = $1
            RETURNING id, attempts
        )
        DELETE FROM public."filesExtractionQueue"
        WHERE id IN (SELECT id FROM bumped WHERE attempts >= $2)`,
        [id, NUSKAITYMO_BANDYMAI],
    );
}
