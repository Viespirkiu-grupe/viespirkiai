import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { OCR_BANDYMAI } from "../failai/ocr.js";

/**
 * Išvalo užstrigusias OCR užduotis iš eilės (lockedAt > 1 valanda).
 * Atnaujina bandymai, perkelia atgal į eilę arba pašalina jei viršijo bandymus.
 */
export async function pravalytiOcrRezervacijas() {
    const limit = 10;

    // Eilutė grąžinama į eilę arba pašalinama, o files."ocrStatus" gauna
    // -6 (viršijo bandymus) arba 0 (vėl rekomenduojama).
    const res = await postgres.query(
        `
        WITH stale AS (
            SELECT id, attempts
            FROM files."ocrQueue"
            WHERE "lockedBy" IS NOT NULL
              AND "lockedAt" <= NOW() - INTERVAL '1 hour'
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        ),
        bumped AS (
            UPDATE files."ocrQueue" q
            SET "lockedBy" = NULL,
                "lockedAt" = NULL,
                attempts   = s.attempts + 1
            FROM stale s
            WHERE q.id = s.id
            RETURNING q.id, q.attempts
        ),
        pasalinti AS (
            DELETE FROM files."ocrQueue"
            WHERE id IN (SELECT id FROM bumped WHERE attempts >= $2)
            RETURNING id
        )
        UPDATE files."ocrStatus" o
        SET status          = CASE WHEN b.attempts >= $2 THEN -6 ELSE 0 END,
            "nodeId"        = NULL,
            "lockTimestamp" = NULL,
            attempts        = b.attempts
        FROM bumped b
        WHERE o.id = b.id
        RETURNING o.id, o.status
        `,
        [limit, OCR_BANDYMAI],
    );

    if (res.rowCount > 0) {
        const exceeded = res.rows.filter((r) => r.status === -6).length;
        const requeued = res.rowCount - exceeded;
        log(
            `Išvalytos ${res.rowCount} OCR rezervacijos: ${requeued} grąžinta į eilę, ${exceeded} viršijo bandymus`,
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
            updated = await pravalytiOcrRezervacijas();
            log(`Išvalytos rezervuotos OCR užduotys.`);
        } while (updated);
    })();
}
