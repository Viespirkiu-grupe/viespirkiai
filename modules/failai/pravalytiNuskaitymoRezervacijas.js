import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import { NUSKAITYMO_BANDYMAI } from "./nuskaitymoEile.js";
const logger = new Logger();

/**
 * Išvalo užstrigusias nuskaitymo užduotis iš eilės (lockedAt > 30 minučių).
 * Bandymas užskaitomas, failas atidedamas, o viršijus bandymų ribą — pašalinamas iš eilės.
 */
export async function pravalytiNuskaitymoRezervacijas() {
    const limit = 10;

    const res = await postgres.query(
        `
        WITH stale AS (
            SELECT id
            FROM public."filesExtractionQueue"
            WHERE "lockedBy" IS NOT NULL
              AND "lockedAt" <= NOW() - INTERVAL '30 minutes'
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        ),
        bumped AS (
            UPDATE public."filesExtractionQueue" q
            SET attempts = q.attempts + 1,
                "nextAttempt" = NOW() + LEAST(
                    INTERVAL '1 day',
                    INTERVAL '5 minutes' * POWER(2, q.attempts)
                ),
                "lockedBy" = NULL,
                "lockedAt" = NULL
            FROM stale s
            WHERE q.id = s.id
            RETURNING q.id, q.attempts
        ),
        pasalinti AS (
            DELETE FROM public."filesExtractionQueue"
            WHERE id IN (SELECT id FROM bumped WHERE attempts >= $2)
            RETURNING id
        )
        SELECT (SELECT count(*) FROM bumped)::int    AS atlaisvinta,
               (SELECT count(*) FROM pasalinti)::int AS pasalinta
        `,
        [limit, NUSKAITYMO_BANDYMAI],
    );

    const { atlaisvinta, pasalinta } = res.rows[0];
    if (atlaisvinta > 0) {
        logger.log(
            `Išvalytos ${atlaisvinta} nuskaitymo rezervacijos: ${atlaisvinta - pasalinta} grąžinta į eilę, ${pasalinta} viršijo bandymus`,
        );
        return true;
    }
    return false;
}

// jei vykdomas tiesiogiai
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        let updated;
        do {
            updated = await pravalytiNuskaitymoRezervacijas();
        } while (updated);
        await postgres.end();
    })();
}
