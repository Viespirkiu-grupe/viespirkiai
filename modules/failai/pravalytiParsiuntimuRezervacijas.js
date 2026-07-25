import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

/**
 * Išvalo užstrigusias parsisiuntimo užduotis (lockedAt > 15 minučių).
 * Bandymų skaitiklis jau padidintas rezervuojant, tad čia jo neliečiam — tik
 * atlaisvinam ir pažymim klaidą.
 */
export async function pravalytiParsiuntimoRezervacijas() {
    const res = await postgres.query(
        `
        WITH atlaisvinti AS (
            UPDATE public."filesDownloadQueue"
            SET "lockedBy" = NULL,
                "lockedAt" = NULL
            WHERE "lockedBy" IS NOT NULL
              AND "lockedAt" <= NOW() - INTERVAL '15 minutes'
            RETURNING id
        )
        UPDATE public.files f
        SET "downloadStatus" = -1
        FROM atlaisvinti a
        WHERE f.id = a.id
        RETURNING f.id
        `,
    );

    if (res.rowCount > 0) {
        logger.log(`Išvalytos ${res.rowCount} parsisiuntimo rezervacijos`);
        return true;
    }
    return false;
}

// jei vykdomas tiesiogiai
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        let updated;
        do {
            updated = await pravalytiParsiuntimoRezervacijas();
        } while (updated);
    })();
}
