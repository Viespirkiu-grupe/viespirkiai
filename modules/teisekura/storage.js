import { postgres } from "../../postgres/postgres.js";

function nullableTimestamp(value) {
    return typeof value === "string" && value.trim() === "" ? null : value ?? null;
}

export async function upsertInventoryObject(object) {
    const { rows } = await postgres.query(
        `INSERT INTO public."teisekuraObjektai" (
            source, "sourceId", "rootSourceId", "parentSourceId", kind, url,
            pavadinimas, "registracijosNr", "dokumentoNr", "happenedAt",
            "sourceUpdatedAt"
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (source, "sourceId") DO UPDATE SET
            "rootSourceId" = EXCLUDED."rootSourceId",
            "parentSourceId" = EXCLUDED."parentSourceId",
            kind = EXCLUDED.kind,
            url = EXCLUDED.url,
            pavadinimas = EXCLUDED.pavadinimas,
            "registracijosNr" = EXCLUDED."registracijosNr",
            "dokumentoNr" = EXCLUDED."dokumentoNr",
            "happenedAt" = EXCLUDED."happenedAt",
            "sourceUpdatedAt" = EXCLUDED."sourceUpdatedAt",
            "scrapeState" = CASE
                WHEN $12::boolean
                  OR public."teisekuraObjektai"."sourceUpdatedAt" IS DISTINCT FROM EXCLUDED."sourceUpdatedAt"
                  OR public."teisekuraObjektai".pavadinimas IS DISTINCT FROM EXCLUDED.pavadinimas
                  OR public."teisekuraObjektai"."registracijosNr" IS DISTINCT FROM EXCLUDED."registracijosNr"
                  OR public."teisekuraObjektai"."dokumentoNr" IS DISTINCT FROM EXCLUDED."dokumentoNr"
                  OR public."teisekuraObjektai"."happenedAt" IS DISTINCT FROM EXCLUDED."happenedAt"
                THEN 0 ELSE public."teisekuraObjektai"."scrapeState" END
         RETURNING *`,
        [
            object.source, object.sourceId, object.rootSourceId ?? object.sourceId,
            object.parentSourceId ?? null, object.kind, object.url,
            object.pavadinimas ?? null, object.registracijosNr ?? null,
            object.dokumentoNr ?? null, nullableTimestamp(object.happenedAt),
            nullableTimestamp(object.sourceUpdatedAt),
            object.forceRefresh ?? false,
        ],
    );
    return rows[0];
}

export async function claimInventoryBatch(source, kinds, scrapeVersion, limit = 10) {
    const { rows } = await postgres.query(
        // Sąlyga išskaidyta į 4 tarpusavyje nesikertančias šakas (pagal scrapeState:
        // 0 / >0 / -1 / -2), kad kiekviena galėtų naudoti queue_idx
        // (source, kind, scrapeState, retryAt) vietoj seq scan'o dėl didelio OR.
        // FOR UPDATE negalimas tiesiogiai su UNION, tad kiekviena šaka – atskiras
        // CTE su savo LIMIT + SKIP LOCKED; galutinis claimed perrikiuoja ir ima top $4.
        `WITH
         c_new AS (
            SELECT id, "happenedAt"
            FROM public."teisekuraObjektai"
            WHERE source = $1 AND kind = ANY($2)
              AND "scrapeState" = 0
              AND ("retryAt" IS NULL OR "retryAt" <= now())
            ORDER BY "happenedAt" DESC NULLS LAST, id
            LIMIT $4 FOR UPDATE SKIP LOCKED
         ),
         c_stale AS (
            SELECT id, "happenedAt"
            FROM public."teisekuraObjektai"
            WHERE source = $1 AND kind = ANY($2)
              AND "scrapeState" > 0 AND "scrapeVersion" < $3
              AND ("retryAt" IS NULL OR "retryAt" <= now())
            ORDER BY "happenedAt" DESC NULLS LAST, id
            LIMIT $4 FOR UPDATE SKIP LOCKED
         ),
         c_retry AS (
            SELECT id, "happenedAt"
            FROM public."teisekuraObjektai"
            WHERE source = $1 AND kind = ANY($2)
              AND "scrapeState" = -1 AND "retryAt" <= now()
            ORDER BY "happenedAt" DESC NULLS LAST, id
            LIMIT $4 FOR UPDATE SKIP LOCKED
         ),
         c_inflight AS (
            SELECT id, "happenedAt"
            FROM public."teisekuraObjektai"
            WHERE source = $1 AND kind = ANY($2)
              AND "scrapeState" = -2 AND "checkedAt" < now() - interval '1 hour'
              AND ("retryAt" IS NULL OR "retryAt" <= now())
            ORDER BY "happenedAt" DESC NULLS LAST, id
            LIMIT $4 FOR UPDATE SKIP LOCKED
         ),
         claimed AS (
            SELECT id
            FROM (
                SELECT id, "happenedAt" FROM c_new
                UNION ALL SELECT id, "happenedAt" FROM c_stale
                UNION ALL SELECT id, "happenedAt" FROM c_retry
                UNION ALL SELECT id, "happenedAt" FROM c_inflight
            ) u
            ORDER BY "happenedAt" DESC NULLS LAST, id
            LIMIT $4
         )
         UPDATE public."teisekuraObjektai" t
         SET "scrapeState" = -2, attempts = attempts + 1, "checkedAt" = now()
         FROM claimed
         WHERE t.id = claimed.id
         RETURNING t.*`,
        [source, kinds, scrapeVersion, limit],
    );
    return rows;
}

export async function markInventorySuccess(id, { scrapeVersion, contentHash, md5 }) {
    await postgres.query(
        `UPDATE public."teisekuraObjektai"
         SET "scrapeState" = $2, "scrapeVersion" = $2, "contentHash" = $3,
             md5 = $4, "retryAt" = NULL,
             "lastError" = NULL, "checkedAt" = now()
         WHERE id = $1`,
        [id, scrapeVersion, contentHash, md5],
    );
}

export async function markInventoryFailure(id, error) {
    const message = error instanceof Error ? error.message : String(error);
    await postgres.query(
        `UPDATE public."teisekuraObjektai"
         SET "scrapeState" = -1, "lastError" = $2,
             "retryAt" = now() + LEAST(interval '7 days', interval '5 minutes' * power(2, LEAST(attempts, 11))),
             "checkedAt" = now()
         WHERE id = $1`,
        [id, message.slice(0, 4000)],
    );
}

export async function recordInterval(interval) {
    await postgres.query(
        `INSERT INTO public."teisekuraIntervalai"
            (source, kind, "dateFrom", "dateTo", "partition", "sourceCount", "scrapedCount",
             "completedAt", "lastError")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (source, kind, "dateFrom", "dateTo", "partition") DO UPDATE SET
            "sourceCount" = EXCLUDED."sourceCount",
            "scrapedCount" = EXCLUDED."scrapedCount",
            "completedAt" = EXCLUDED."completedAt",
            "checkedAt" = now(),
            "lastError" = EXCLUDED."lastError"`,
        [
            interval.source, interval.kind, interval.dateFrom, interval.dateTo,
            interval.partition ?? "", interval.sourceCount ?? null,
            interval.scrapedCount ?? null, interval.completedAt ?? null,
            interval.lastError ?? null,
        ],
    );
}
