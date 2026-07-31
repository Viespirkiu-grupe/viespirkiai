import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import { OCR_BANDYMAI } from "./ocr.js";
import { iOcrEile } from "./ocrEile.js";
const logger = new Logger();

/**
 * Išvalo užstrigusias OCR rezervacijas (filesOcrStatus.status = -3, kurių
 * lockTimestamp senesnis nei 30 minučių).
 *
 * Skirtumas nuo kitų dviejų valytojų: OCR rezervacija gyvena dviejose lentelėse —
 * lock'as eilėje ir būsena filesOcrStatus. Node'ui kritus būsena lieka amžinai,
 * failas rodomas kaip „Rezervuota“ ir OCR jam nebedaromas, net jei eilės lock'as
 * jau atlaisvintas. Tad čia nuimama ir būsena, o iš eilės iškritę failai (pvz.
 * po eilės migracijos) grąžinami atgal — jų neatstatytų niekas kitas, nes eilę
 * pildo tik nuskaitymo kelias.
 */
export async function pravalytiOcrRezervacijas() {
    const limit = 100;

    const res = await postgres.query(
        `
        WITH stale AS (
            SELECT id, "resultHash" IS NOT NULL AS "turiRezultata"
            FROM public."filesOcrStatus"
            WHERE status = -3
              AND ("lockTimestamp" IS NULL
                   OR "lockTimestamp" <= NOW() - INTERVAL '30 minutes')
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        ),
        bumped AS (
            UPDATE public."filesOcrQueue" q
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
            DELETE FROM public."filesOcrQueue"
            WHERE id IN (SELECT id FROM bumped WHERE attempts >= $2)
            RETURNING id
        ),
        -- Rezultatas realiai yra: failas buvo pernuskaitomas ir pakibo jau po to.
        baigtos AS (
            UPDATE public."filesOcrStatus"
            SET status = 1, "lockTimestamp" = NULL
            WHERE id IN (SELECT id FROM stale WHERE "turiRezultata")
            RETURNING id
        ),
        -- Be rezultato eilutėje nėra ko saugoti — lieka tik negaliojantis lock'as.
        istrintos AS (
            DELETE FROM public."filesOcrStatus"
            WHERE id IN (SELECT id FROM stale WHERE NOT "turiRezultata")
            RETURNING id
        )
        SELECT (SELECT count(*) FROM bumped)::int    AS atlaisvinta,
               (SELECT count(*) FROM pasalinti)::int AS pasalinta,
               (SELECT count(*) FROM baigtos)::int   AS baigta,
               COALESCE((SELECT array_agg(id) FROM istrintos), '{}') AS "istrintosId"
        `,
        [limit, OCR_BANDYMAI],
    );

    const { atlaisvinta, pasalinta, baigta, istrintosId } = res.rows[0];
    const istrinta = istrintosId.length;

    if (!atlaisvinta && !baigta && !istrinta) return false;

    // Grąžinami tik tinkami (plėtinys, nuskaitymo versija) — tikrina pati iOcrEile.
    const grazinta = istrinta ? await iOcrEile(istrintosId) : 0;

    logger.log(
        `Išvalytos OCR rezervacijos: atlaisvinta ${atlaisvinta} eilės lock'ų ` +
            `(${pasalinta} viršijo bandymus), pažymėta baigtomis ${baigta}, ` +
            `nuimta pakibusių būsenų ${istrinta} (į eilę grąžinta ${grazinta})`,
    );
    return true;
}

// jei vykdomas tiesiogiai
if (import.meta.url === `file://${process.argv[1]}`) {
    (async () => {
        let updated;
        do {
            updated = await pravalytiOcrRezervacijas();
        } while (updated);
        await postgres.end();
    })();
}
