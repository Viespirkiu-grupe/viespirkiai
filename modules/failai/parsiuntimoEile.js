import { postgres } from "../../postgres/postgres.js";
import { FILES_JOINS, FILES_SELECT, papildytiFaila } from "./filesSkaitymas.js";

/*
Parsiuntimo eilė — `filesDownloadQueue`.

Eilėje tik neatlikti darbai: reikia parsiųsti — eilutė yra, nebereikia — nėra.
Būsena (`files.downloadStatus`, `md5Id`, `filesize`) ir dėžių žemėlapis
(`filesMd5Boxes`) gyvena `files` pusėje, eilė saugo tik bandymų skaičių,
atidėjimą ir rezervaciją.

Pakartojimo atidėjimas
----------------------
`nextAttempt` yra jau apskaičiuota laukiama reikšmė, todėl checkout užklausai
pakanka `<= NOW()`. Pakopos perimtos iš senosios schemos, kur tas pats buvo
skaičiuojama užklausoje iš `bandymai` ir `paskutinisBandymas`.
*/

/** Pakartojimo atidėjimas pagal bandymų skaičių — tos pačios pakopos kaip senoje eilėje. */
const ATIDEJIMAS_SQL = `
    CASE
        WHEN q.attempts + 1 < 6  THEN INTERVAL '3 hours'
        WHEN q.attempts + 1 < 30 THEN INTERVAL '12 hours'
        WHEN q.attempts + 1 < 54 THEN INTERVAL '1 day'
        ELSE INTERVAL '3 days'
    END`;

/**
 * Paima vieną failą parsiuntimui ir uždeda rezervaciją.
 * @param {string} nodeName
 * @param {import("pg").ClientBase} [klientas]
 * @returns {Promise<Object|null>} failo eilutė senuoju pavidalu arba null
 */
export async function paimtiParsiuntimui(nodeName, klientas = postgres) {
    const { rows } = await klientas.query(
        `WITH cte AS (
            SELECT q.id FROM public."filesDownloadQueue" q
            WHERE q."lockedBy" IS NULL
              AND (q."nextAttempt" IS NULL OR q."nextAttempt" <= NOW())
            ORDER BY q.attempts, q.id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        ),
        locked AS (
            UPDATE public."filesDownloadQueue" q
            SET "lockedBy" = $1,
                "lockedAt" = NOW(),
                attempts = q.attempts + 1,
                "nextAttempt" = NOW() + ${ATIDEJIMAS_SQL}
            FROM cte WHERE q.id = cte.id
            RETURNING q.id
        )
        SELECT ${FILES_SELECT}
        FROM public.files f
        ${FILES_JOINS}
        WHERE f.id = (SELECT id FROM locked)`,
        [nodeName],
    );

    return papildytiFaila(rows[0] ?? null);
}

/**
 * Pažymi failą kaip parsiųstą ir užregistruoja dėžę.
 *
 * `filesMd5Boxes."extensionId"` fiksuoja plėtinį, su kuriuo failas įkeltas —
 * dėžėje objektas vadinasi "{md5}.{extension}", o `files."extensionId"` vėliau
 * gali būti pataisytas (pataisytiExtension.js).
 *
 * @param {Object} p
 * @param {number} p.id
 * @param {string} p.md5
 * @param {number} p.dydis
 * @param {number} p.dezeId - dezes.id
 * @param {string|null} p.extension
 * @param {import("pg").ClientBase} [klientas]
 */
export async function pazymetiParsiusta({
    id,
    md5,
    dydis,
    dezeId,
    extension,
}, klientas = postgres) {
    const { rows } = await klientas.query(
        `WITH md5_id AS (
            INSERT INTO public."filesMd5" (md5) VALUES ($1)
            ON CONFLICT (md5) DO UPDATE SET md5 = EXCLUDED.md5
            RETURNING id
        ),
        ext_id AS (
            INSERT INTO public."filesExtensions" (extension)
            SELECT $2::text WHERE $2 IS NOT NULL
            ON CONFLICT (extension) DO UPDATE SET extension = EXCLUDED.extension
            RETURNING id
        )
        SELECT (SELECT id FROM md5_id) AS "md5Id",
               (SELECT id FROM ext_id) AS "extensionId"`,
        [md5, extension ? String(extension).toLowerCase() : null],
    );
    const { md5Id, extensionId } = rows[0];

    await klientas.query(
        `INSERT INTO public."filesMd5Boxes" ("md5Id", "boxId", filesize, "extensionId")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("md5Id", "boxId") DO NOTHING`,
        [md5Id, dezeId, dydis, extensionId],
    );
    await klientas.query(
        `UPDATE public.files
         SET "downloadStatus" = 1, "md5Id" = $1, filesize = $2
         WHERE id = $3`,
        [md5Id, dydis, id],
    );
    await klientas.query(
        `DELETE FROM public."filesDownloadQueue" WHERE id = $1`,
        [id],
    );
}

/**
 * Pažymi nepavykusį parsiuntimą ir atlaisvina rezervaciją.
 * Bandymų skaitiklis jau padidintas rezervuojant, tad čia jo neliečiam.
 * @param {number} id
 * @param {import("pg").ClientBase} [klientas]
 */
export async function pazymetiKlaida(id, klientas = postgres) {
    await klientas.query(
        `UPDATE public.files SET "downloadStatus" = -1 WHERE id = $1`,
        [id],
    );
    await klientas.query(
        `UPDATE public."filesDownloadQueue"
         SET "lockedBy" = NULL,
             "lockedAt" = NULL
         WHERE id = $1`,
        [id],
    );
}
