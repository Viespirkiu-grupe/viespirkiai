import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

/**
 * Išvalo užstrigusias parsisiuntimo užduotis iš eilės (lockedAt > 10 minučių).
 */
export async function pravalytiParsiuntimoRezervacijas() {
    const res = await postgres.query(
        `
        UPDATE public."failaiParsiuntimoQueue"
        SET "lockedBy"           = NULL,
            "lockedAt"           = NULL,
            "paskutinisBandymas" = NOW(),
            bandymai             = bandymai + 1,
            state                = -1
        WHERE "lockedBy" IS NOT NULL
          AND "lockedAt" <= NOW() - INTERVAL '15 minutes'
        RETURNING id
        `,
    );

    if (res.rowCount > 0) {
        log(`Išvalytos ${res.rowCount} parsisiuntimo rezervacijos`);
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