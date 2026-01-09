import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

/**
 * Išvalo rezervuotas OCR užduotis, kurios buvo rezervuotos daugiau nei prieš 3 valandas.
 * Vykdo po 100 eilučių vienu metu.
 */
export async function pravalytiOcrRezervacijas() {
    const limit = 10;

    const res = await postgres.query(
        `
        WITH to_update AS (
            SELECT "id"
            FROM failai
            WHERE "ocrState" = -3
              AND "ocrLockTimestamp" <= (now() AT TIME ZONE 'Europe/Vilnius' - interval '1 hours')
            LIMIT $1
        )
        UPDATE failai f
        SET
            "ocrState" = 0,
            "ocrLockTimestamp" = NULL,
            "ocrNode" = NULL
        FROM to_update t
        WHERE f."id" = t."id"
        RETURNING f."id";
    `,
        [limit],
    );

    return res.rowCount;
}

// jei vykdomas tiesiogiai
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        let updated;
        do {
            updated = await pravalytiOcrRezervacijas();
            log(`Išvalytos ${updated} rezervuotos OCR užduotys.`);
        } while (updated > 0);
    })();
}
