import { postgres } from "../../postgres/postgres.js";
import { FILES_JOINS, FILES_SELECT, papildytiFaila } from "./filesSkaitymas.js";
import { OCR_BANDYMAI, OCR_DOC_EXTS, OCR_IMAGE_EXTS } from "./ocr.js";
import { atnaujintiFilesPhotos } from "./photosLentele.js";

/*
OCR eilė — `filesOcrQueue`, būsena — `filesOcrStatus`.

Rezultatų istorijos nėra: laikoma tik rodyklė į paskutinį FS rezultatą
(`resultHash`, ją nuskaitymas paduoda dokNuskaitytojui) ir bendras rezultatų
skaičius (`resultsCount`, rodomas failo puslapyje). Dienos pjūvį kaupia
`filesOcrStatsDay`.

Prioritetai:
  0 — OCR rekomenduojamas (status = 0)
  1 — paveikslėlių formatai
  2 — dokumentų formatai
*/

/**
 * Įdeda failus į OCR eilę.
 * Tinkamumą tikrina pati užklausa — kviečiantiesiems taisyklių žinoti nereikia.
 *
 * @param {number[]} failuId
 * @param {import("pg").ClientBase} [klientas]
 * @returns {Promise<number>} kiek eilučių pridėta
 */
export async function iOcrEile(failuId, klientas = postgres) {
    if (!failuId?.length) return 0;

    const res = await klientas.query(
        `INSERT INTO public."filesOcrQueue" (id, priority)
         SELECT f.id,
                CASE
                    WHEN o.status = 0 THEN 0
                    WHEN LOWER(e.extension) = ANY($2::text[]) THEN 1
                    ELSE 2
                END
         FROM public.files f
         LEFT JOIN public."filesExtensions" e ON e.id = f."extensionId"
         LEFT JOIN public."filesOcrStatus" o ON o.id = f.id
         LEFT JOIN public."filesDataExtraction" d ON d.id = f.id
         WHERE f.id = ANY($1::int[])
           AND (
               o.status = 0
               OR (o.status IS NULL
                   AND COALESCE(d.version, 0) >= 6
                   AND LOWER(e.extension) = ANY($4::text[]))
           )
           AND COALESCE(o.attempts, 0) < $3
         ON CONFLICT (id) DO NOTHING`,
        [
            failuId,
            OCR_IMAGE_EXTS,
            OCR_BANDYMAI,
            [...OCR_IMAGE_EXTS, ...OCR_DOC_EXTS],
        ],
    );

    return res.rowCount;
}

/**
 * Rezervuoja failą OCR'ui.
 *
 * @param {Object} node - ocrNuskaitytojai eilutė ({ id, pavadinimas })
 * @param {import("pg").ClientBase} [klientas]
 * @returns {Promise<Record<string, any>|null>} failo eilutė senuoju pavidalu arba null
 */
export async function paimtiOcr(node, klientas = postgres) {
    const { rows } = await klientas.query(
        `WITH cte AS (
            SELECT q.id FROM public."filesOcrQueue" q
            WHERE q."lockedBy" IS NULL
              AND q.attempts < $2
              AND (q."nextAttempt" IS NULL OR q."nextAttempt" <= NOW())
            ORDER BY q.priority, q.id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        ),
        locked AS (
            UPDATE public."filesOcrQueue" q
            SET "lockedBy" = $1,
                "lockedAt" = NOW()
            FROM cte
            WHERE q.id = cte.id
            RETURNING q.id
        )
        SELECT ${FILES_SELECT}
        FROM public.files f
        ${FILES_JOINS}
        WHERE f.id = (SELECT id FROM locked)`,
        [node.pavadinimas, OCR_BANDYMAI],
    );

    const failas = papildytiFaila(rows[0] ?? null);
    if (!failas) return null;

    // Būsena — rezervuota (-3).
    await klientas.query(
        `INSERT INTO public."filesOcrStatus" (id, status, "nodeId", "lockTimestamp")
         VALUES ($1, -3, $2, NOW())
         ON CONFLICT (id) DO UPDATE SET
            status          = -3,
            "nodeId"        = EXCLUDED."nodeId",
            "lockTimestamp" = EXCLUDED."lockTimestamp"`,
        [failas.id, node.id],
    );

    // ocrNuskaitytojai."rezervacijos" čia sąmoningai neliečiamas: rodoma reikšmė
    // yra dabartinių rezervacijų kiekis, o jis skaičiuojamas gyvai iš status = -3
    // (žr. ocr.astro). Rankinis skaitiklis reikalautų dekremento visuose grąžinimo
    // keliuose ir neišvengiamai nudriftuotų.
    return failas;
}

/**
 * OCR rezultatas: būsena, rodyklė į FS rezultatą, eilės išvalymas ir dienos statistika.
 *
 * @param {Object} p
 * @param {number} p.id
 * @param {number} p.nodeId - ocrNuskaitytojai.id
 * @param {string} p.md5 - rezultato raktas FS'e (rezultataiFs.js)
 * @param {number} p.duration
 * @param {number} p.pageCount
 * @param {number} p.wordCount
 * @param {import("pg").ClientBase} [klientas]
 */
export async function pazymetiOcrRezultata(
    { id, nodeId, md5, duration, pageCount, wordCount },
    klientas = postgres,
) {
    await klientas.query(
        `INSERT INTO public."filesOcrStatus"
            (id, status, "nodeId", "lockTimestamp", duration, "ocrTimestamp", "resultHash", "resultsCount")
         VALUES ($1, 1, $2, NULL, $3, NOW(), $4, 1)
         ON CONFLICT (id) DO UPDATE SET
            status          = 1,
            "nodeId"        = EXCLUDED."nodeId",
            "lockTimestamp" = NULL,
            duration        = EXCLUDED.duration,
            "ocrTimestamp"  = EXCLUDED."ocrTimestamp",
            "resultHash"    = EXCLUDED."resultHash",
            "resultsCount"  = public."filesOcrStatus"."resultsCount" + 1`,
        [id, nodeId, duration, md5],
    );

    await klientas.query(
        `DELETE FROM public."filesOcrQueue" WHERE id = $1`,
        [id],
    );

    // Ką tik įrašytas status = 1 yra momentas, kai nuotrauka tampa tinkama galerijai.
    // Matmenų šis kelias neturi — juos užpildys po OCR sekantis pernuskaitymas.
    await atnaujintiFilesPhotos(id, {}, klientas);

    // Dienos statistika — vietoj buvusių trijų failaiOcrRezultataiStats* lentelių.
    await klientas.query(
        `INSERT INTO public."filesOcrStatsDay" (date, "nodeId", results, pages, words, duration)
         VALUES ((NOW() AT TIME ZONE 'Europe/Vilnius')::date, $1, 1, $2, $3, $4)
         ON CONFLICT (date, "nodeId") DO UPDATE SET
            results  = public."filesOcrStatsDay".results + 1,
            pages    = public."filesOcrStatsDay".pages + EXCLUDED.pages,
            words    = public."filesOcrStatsDay".words + EXCLUDED.words,
            duration = public."filesOcrStatsDay".duration + EXCLUDED.duration`,
        [nodeId, pageCount, wordCount, duration],
    );

    // Kaupiamasis nuskaitytojo skaitiklis — pernuskaitymas skaičiuojamas kaip
    // atskiras nuskaitymas (kaip ir filesOcrStatus."resultsCount").
    await klientas.query(
        `UPDATE public."ocrNuskaitytojai"
         SET "nuskaitytiDokumentai" = COALESCE("nuskaitytiDokumentai", 0) + 1
         WHERE id = $1`,
        [nodeId],
    );
}
