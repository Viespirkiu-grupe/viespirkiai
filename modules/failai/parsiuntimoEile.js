import { postgres } from "../../postgres/postgres.js";
import { FILES_JOINS, FILES_SELECT, papildytiFaila } from "./filesSkaitymas.js";

/*
Parsiuntimo eilė — `files."downloadQueue"`.

Eilėje tik neatlikti darbai: reikia parsiųsti — eilutė yra, nebereikia — nėra.
Būsena (`files.downloadStatus`, `md5Id`, `filesize`) ir dėžių žemėlapis
(`files."md5Boxes"`) gyvena `files` pusėje, eilė saugo tik bandymų skaičių,
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
            SELECT q.id FROM files."downloadQueue" q
            WHERE q."lockedBy" IS NULL
              AND (q."nextAttempt" IS NULL OR q."nextAttempt" <= NOW())
            ORDER BY q.attempts, q.id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        ),
        locked AS (
            UPDATE files."downloadQueue" q
            SET "lockedBy" = $1,
                "lockedAt" = NOW(),
                attempts = q.attempts + 1,
                "nextAttempt" = NOW() + ${ATIDEJIMAS_SQL}
            FROM cte WHERE q.id = cte.id
            RETURNING q.id
        )
        SELECT ${FILES_SELECT}
        FROM files.files f
        ${FILES_JOINS}
        WHERE f.id = (SELECT id FROM locked)`,
        [nodeName],
    );

    return papildytiFaila(rows[0] ?? null);
}

/**
 * Pažymi failą kaip parsiųstą ir užregistruoja dėžę.
 *
 * `files."md5Boxes"."extensionId"` fiksuoja plėtinį, su kuriuo failas įkeltas —
 * dėžėje objektas vadinasi "{md5}.{extension}", o `files.files."extensionId"` vėliau
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
            INSERT INTO files."md5" (md5) VALUES ($1)
            ON CONFLICT (md5) DO UPDATE SET md5 = EXCLUDED.md5
            RETURNING id
        ),
        ext_id AS (
            INSERT INTO files."extensions" (extension)
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
        `INSERT INTO files."md5Boxes" ("md5Id", "boxId", filesize, "extensionId")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("md5Id", "boxId") DO NOTHING`,
        [md5Id, dezeId, dydis, extensionId],
    );
    await klientas.query(
        `UPDATE files.files
         SET "downloadStatus" = 1, "md5Id" = $1, filesize = $2
         WHERE id = $3`,
        [md5Id, dydis, id],
    );
    await klientas.query(
        `DELETE FROM files."downloadQueue" WHERE id = $1`,
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
        `UPDATE files.files SET "downloadStatus" = -1 WHERE id = $1`,
        [id],
    );
    await klientas.query(
        `UPDATE files."downloadQueue"
         SET "lockedBy" = NULL,
             "lockedAt" = NULL
         WHERE id = $1`,
        [id],
    );
}
