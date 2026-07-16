import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();

/**
 * Išvalo užstrigusias parsisiuntimo užduotis iš eilės (lockedAt > 10 minučių).
 */
export async function pravalytiParsiuntimoRezervacijas() {
    const res = await postgres.query(
        `
        UPDATE public."failaiParsiuntimoQueue"
        SET "lockedBy"           = NULL,
            "lockedAt"           = NULL,
            state                = -1
        WHERE "lockedBy" IS NOT NULL
          AND "lockedAt" <= NOW() - INTERVAL '15 minutes'
        RETURNING id
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
