import { randomUUID } from "node:crypto";
import { postgres } from "../../postgres/postgres.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

export const ESEIMAS_QUEUE_KINDS = ["document", "editions", "asr", "historical"];

const PENDING_SOURCES = {
    document: {
        from: `public."eSeimasLegalActScrape" s`,
        pending: `s."documentScrapedAt" IS NULL`,
        token: `''`,
        order: `s."discoveredAt", s."category", s."legalActId"`,
    },
    editions: {
        from: `public."eSeimasLegalActScrape" s`,
        pending: `s."editionsScrapedAt" IS NULL`,
        token: `''`,
        order: `s."discoveredAt", s."category", s."legalActId"`,
    },
    asr: {
        from: `public."eSeimasLegalActScrape" s`,
        pending: `s."asrScrapedAt" IS NULL`,
        token: `''`,
        order: `s."discoveredAt", s."category", s."legalActId"`,
    },
    historical: {
        from: `public."eSeimasEdition" s`,
        pending: `s."scrapedAt" IS NULL`,
        token: `s."editionToken"`,
        order: `s."category", s."legalActId", s.ordinal`,
    },
};

function requireKind(kind) {
    const source = PENDING_SOURCES[kind];
    if (!source) throw new Error(`Nežinoma e-Seimas eilės rūšis: ${kind}`);
    return source;
}

/**
 * Periodiškai sutikrina progreso lenteles su TaskRunner eile. Taip naujai
 * atrasti aktai patenka į darbus ir po proceso lūžio tarp discovery bei enqueue.
 */
export async function enqueuePendingESeimasJobs(kind, { limit = 1000 } = {}) {
    const source = requireKind(kind);
    const { rowCount } = await postgres.query(
        `INSERT INTO public."eSeimasScrapeQueue" (kind, "category", "legalActId", "editionToken")
         SELECT $1, s."category", s."legalActId", ${source.token}
         FROM ${source.from}
         WHERE ${source.pending}
           AND NOT EXISTS (
               SELECT 1
               FROM public."eSeimasScrapeQueue" q
               WHERE q.kind = $1
                 AND q."category" = s."category"
                 AND q."legalActId" = s."legalActId"
                 AND q."editionToken" = ${source.token}
           )
         ORDER BY ${source.order}
         LIMIT $2
         ON CONFLICT (kind, "category", "legalActId", "editionToken") DO NOTHING`,
        [kind, limit],
    );
    const queued = rowCount ?? 0;
    if (queued > 0) {
        signalWork(WORK_SIGNALS.ESEIMAS_SCRAPE_READY, {
            source: "eSeimasScrapeQueue",
            kind,
            count: queued,
        });
    }
    return queued;
}

/**
 * Atominis lease: HTTP užklausos metu DB tranzakcija nelaikoma atidaryta.
 * claimToken apsaugo nuo seno workerio, grįžusio jau pasibaigus jo lease'ui.
 */
/**
 * @param {string} kind
 * @param {{ leaseMinutes?: number, maxFailures?: number, claimToken?: string }} [options]
 */
export async function claimNextESeimasJob(kind, {
    leaseMinutes = 120,
    maxFailures = 5,
    claimToken = randomUUID(),
} = {}) {
    requireKind(kind);
    const { rows: [row] } = await postgres.query(
        `WITH candidate AS (
             SELECT "queueId"
             FROM public."eSeimasScrapeQueue"
             WHERE kind = $1
               AND "failureCount" < $2
               AND ("retryAfter" IS NULL OR "retryAfter" <= now())
               AND ("claimToken" IS NULL OR "leaseUntil" <= now())
             ORDER BY "requestedAt", "queueId"
             FOR UPDATE SKIP LOCKED
             LIMIT 1
         )
         UPDATE public."eSeimasScrapeQueue" q
            SET "claimToken" = $3,
                "claimedAt" = now(),
                "leaseUntil" = now() + ($4 || ' minutes')::interval
           FROM candidate
          WHERE q."queueId" = candidate."queueId"
         RETURNING q."queueId", q.kind, q."category", q."legalActId", q."editionToken",
                   q."claimToken", q."failureCount"`,
        [kind, maxFailures, claimToken, leaseMinutes],
    );
    return row ?? null;
}

export async function completeESeimasJob(job) {
    const { rowCount } = await postgres.query(
        `DELETE FROM public."eSeimasScrapeQueue"
         WHERE "queueId" = $1 AND "claimToken" = $2`,
        [job.queueId, job.claimToken],
    );
    return (rowCount ?? 0) > 0;
}

export async function failESeimasJob(job, error, { backoffMinutes = 30 } = {}) {
    const { rowCount } = await postgres.query(
        `UPDATE public."eSeimasScrapeQueue"
            SET "failureCount" = "failureCount" + 1,
                "lastError" = $3,
                "retryAfter" = now() + ($4 * ("failureCount" + 1) || ' minutes')::interval,
                "claimToken" = NULL,
                "claimedAt" = NULL,
                "leaseUntil" = NULL
          WHERE "queueId" = $1 AND "claimToken" = $2`,
        [job.queueId, job.claimToken, String(error?.message ?? error).slice(0, 2000), backoffMinutes],
    );
    return (rowCount ?? 0) > 0;
}
