import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { OCR_BANDYMAI } from "../failai/ocr.js";

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
            "ocrState" = CASE
                WHEN COALESCE(f."ocrBandymai", 0) + 1 >= ${Number(OCR_BANDYMAI)} THEN -6
                ELSE 0
            END,
            "ocrLockTimestamp" = NULL,
            "ocrNode" = NULL,
            "ocrBandymai" = COALESCE(f."ocrBandymai", 0) + 1
        FROM to_update t
        WHERE f."id" = t."id"
        RETURNING f."id";
        `,
        [limit],
    );

    if (res.rowCount > 0) {
        log(`Išvalytos ${res.rowCount} OCR rezervacijos`);
        return true;
    } else {
        return false;
    }
}

// jei vykdomas tiesiogiai
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        let updated;
        do {
            updated = await pravalytiOcrRezervacijas();
            log(`Išvalytos ${updated} rezervuotos OCR užduotys.`);
        } while (updated);
    })();
}
