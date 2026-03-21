import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { OCR_BANDYMAI } from "../failai/ocr.js";

/**
 * Išvalo užstrigusias OCR užduotis iš eilės (lockedAt > 1 valanda).
 * Atnaujina bandymai, perkelia atgal į eilę arba pašalina jei viršijo bandymus.
 */
export async function pravalytiOcrRezervacijas() {
    const limit = 10;

    const res = await postgres.query(
        `
        WITH stale AS (
            SELECT id, bandymai
            FROM public."failaiOcrQueue"
            WHERE "lockedBy" IS NOT NULL
              AND "lockedAt" <= NOW() - INTERVAL '1 hour'
            LIMIT $1
            FOR UPDATE SKIP LOCKED
        ),
        updated_queue AS (
            UPDATE public."failaiOcrQueue" q
            SET "lockedBy" = NULL,
                "lockedAt" = NULL,
                bandymai   = s.bandymai + 1
            FROM stale s
            WHERE q.id = s.id
            RETURNING q.id, s.bandymai + 1 AS new_bandymai
        ),
        exceeded AS (
            DELETE FROM public."failaiOcrQueue"
            WHERE id IN (
                SELECT id FROM updated_queue WHERE new_bandymai >= $2
            )
            RETURNING id
        )
        UPDATE public.failai f
        SET "ocrBandymai"      = uq.new_bandymai,
            "ocrState"         = CASE WHEN uq.new_bandymai >= $2 THEN -6 ELSE 0 END,
            "ocrNode"          = NULL,
            "ocrLockTimestamp" = NULL
        FROM updated_queue uq
        WHERE f.id = uq.id
        RETURNING f.id, uq.new_bandymai, f."ocrState"
        `,
        [limit, OCR_BANDYMAI],
    );

    if (res.rowCount > 0) {
        const exceeded = res.rows.filter((r) => r.ocrState === -6).length;
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
