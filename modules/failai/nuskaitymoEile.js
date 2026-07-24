import { postgres } from "../../postgres/postgres.js";

/*
Failų nuskaitymo eilė (filesNuskaitymasQueue).

Eilėje laikomi tik neatlikti darbai: reikia nuskaityti — eilutė yra, nebereikia — eilutės nėra.
Būsena (nuskaitymo versija, klaidos kodas) gyvena failai.nuskaitytas, o eilė saugo tik tai, ko
failai lentelė nežino: bandymų skaičių, atidėjimą ir rezervaciją.

Eilę pildo kodas (ne DB trigeris) tuose taškuose, kur failas tampa nuskaitomu:
  - parsisiuntus (parsiusti.js, parsiustas = 1),
  - išskleidus iš archyvo (nuskaitytiTeksta.js, parsiustas = -5),
  - po OCR (failas/ocr/submit.ts, nuskaitytas = 0),
  - rankiniu pakartojimu (nuskaitytiPakartotinai.js, nuskaitytas = 0).
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

    const res = await klientas.query(
        `INSERT INTO public."filesNuskaitymasQueue" (id)
         SELECT f.id FROM public.failai f
         WHERE f.id = ANY($1::int[])
           AND f.parsiustas IN (1, -5)
           AND LOWER(f.extension) = ANY($2::text[])
           AND COALESCE(f.nuskaitytas, 0) < $3
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
        `DELETE FROM public."filesNuskaitymasQueue" WHERE id = ANY($1::int[])`,
        [failuId],
    );

    return res.rowCount;
}
