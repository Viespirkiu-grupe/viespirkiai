import type { PoolClient } from "pg";
import type { ProcurementRiskDecisions } from "../../modules/risk/types.ts";
import { riskProcurementSource } from "../../modules/risk/riskCodes.ts";

export type WriteStats = Readonly<{ written: number }>;

// The signal payload every statement below reads out of the same jsonb
// document: one entry per procurement, its signals nested underneath.
const decisionRecord = `"procurementSource" text, "procurementId" text, "dataAsOf" text, "signals" jsonb`;
const signalRecord =
    `"indicatorId" text, "indicatorVersion" int, "subjectType" text, "subjectKey" text, "state" text, ` +
    `"rawValue" jsonb, "threshold" jsonb, "appliedParameters" jsonb, "missingData" text[]`;

/**
 * Adds whatever this batch mentions that the lookup tables
 * (migrations/risk/002_riskNarrow.sql §1-2) do not hold yet: sources,
 * indicators, parameter sets and missing-field names all grow as indicators
 * are deployed or retuned. Idempotent, and a no-op on every batch after the
 * first for a given deployment.
 *
 * Separate from the signal INSERT because rows a CTE inserts are invisible to
 * its sibling CTEs — the joins in insertSignals must see these rows already
 * committed to the transaction's snapshot.
 *
 * "subjectTypes" and "signalStates" are closed sets seeded by the migration
 * and are deliberately not extended here: an unrecognised value there means a
 * bug, and the inner joins below drop the signal loudly via the row-count
 * check rather than inventing a lookup row for it.
 */
async function seedLookups(client: PoolClient, payload: string): Promise<void> {
    await client.query(
        `
        WITH "input" AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS d(${decisionRecord})
        ),
        "sig" AS (
            SELECT s.* FROM "input" d
                CROSS JOIN LATERAL jsonb_to_recordset(d."signals") AS s(${signalRecord})
        ),
        "newSources" AS (
            INSERT INTO risk."procurementSources" ("code")
            SELECT DISTINCT "procurementSource" FROM "input"
            ON CONFLICT ("code") DO NOTHING
        ),
        "newFields" AS (
            INSERT INTO risk."missingFields" ("code")
            SELECT DISTINCT f FROM "sig", unnest("sig"."missingData") AS f
            ON CONFLICT ("code") DO NOTHING
        ),
        "newParameters" AS (
            INSERT INTO risk."parameterSets" ("threshold", "appliedParameters")
            SELECT DISTINCT "threshold", "appliedParameters" FROM "sig"
            WHERE "threshold" IS NOT NULL OR "appliedParameters" IS NOT NULL
            ON CONFLICT DO NOTHING
        )
        INSERT INTO risk."indicators" ("code", "version", "subjectType")
        SELECT DISTINCT "sig"."indicatorId", "sig"."indicatorVersion"::smallint, st."id"
        FROM "sig" JOIN risk."subjectTypes" st ON st."code" = "sig"."subjectType"
        ON CONFLICT ("code", "version") DO NOTHING
        `,
        [payload],
    );
}

/**
 * risk."procurementDecisions" is current-state, not a snapshot: one row per
 * procurement, refreshed in place on the natural key ("source",
 * "procurementId"). "createdAt" is left out of the DO UPDATE SET list, so it
 * only ever fires on first insert; "updatedAt" advances on every refresh.
 * Returns the surrogate ids the signal statements key off.
 */
async function upsertDecisions(client: PoolClient, payload: string): Promise<number[]> {
    const { rows } = await client.query<{ id: number }>(
        `
        INSERT INTO risk."procurementDecisions" ("source", "procurementId", "dataAsOf")
        SELECT ps."id", d."procurementId", d."dataAsOf"::timestamptz
        FROM jsonb_to_recordset($1::jsonb) AS d(${decisionRecord})
                 JOIN risk."procurementSources" ps ON ps."code" = d."procurementSource"
        ON CONFLICT ("source", "procurementId") DO UPDATE SET
            "dataAsOf"  = excluded."dataAsOf",
            "updatedAt" = now()
        RETURNING "id"
        `,
        [payload],
    );
    return rows.map((row) => row.id);
}

/**
 * A refresh re-evaluates every deployed indicator for a procurement, so the
 * replacement set is always internally consistent: the previous rows are
 * deleted whole and the new ones inserted, never UPDATEd.
 *
 * Everything the narrow schema stores as a smallint is resolved here by
 * joining the lookup tables, so no id mapping crosses back into JavaScript.
 * "subjectKey" drops its `<source>:<procurementId>` prefix — the parent row
 * already holds both. Matching that prefix positionally rather than by the
 * source string keeps it correct across the 'cvpis' -> 'cvpIs' rename and for
 * bid keys whose tiekejoKodas itself contains a colon.
 */
async function insertSignals(client: PoolClient, payload: string): Promise<void> {
    await client.query(
        `
        INSERT INTO risk."signals" (
            "decisionId", "indicator", "state", "parameterSet", "subjectKey", "rawValue", "missingData"
        )
        SELECT dec."id",
               i."id",
               st."id",
               p."id",
               regexp_replace(s."subjectKey", '^[^:]*:[^:]*:?', ''),
               s."rawValue",
               CASE WHEN coalesce(cardinality(s."missingData"), 0) = 0 THEN NULL ELSE (
                   SELECT array_agg(mf."id" ORDER BY u.ord)
                   FROM unnest(s."missingData") WITH ORDINALITY AS u(code, ord)
                            JOIN risk."missingFields" mf ON mf."code" = u.code
               ) END
        FROM jsonb_to_recordset($1::jsonb) AS d(${decisionRecord})
                 CROSS JOIN LATERAL jsonb_to_recordset(d."signals") AS s(${signalRecord})
                 JOIN risk."procurementSources" ps ON ps."code" = d."procurementSource"
                 JOIN risk."procurementDecisions" dec
                      ON dec."source" = ps."id" AND dec."procurementId" = d."procurementId"
                 JOIN risk."indicators" i
                      ON i."code" = s."indicatorId" AND i."version" = s."indicatorVersion"
                 JOIN risk."signalStates" st ON st."code" = s."state"
                 -- Plain equality, not IS NOT DISTINCT FROM: a signal with no
                 -- parameters has NULL in both columns, does not match, and
                 -- correctly stores a NULL "parameterSet".
                 LEFT JOIN risk."parameterSets" p
                      ON p."threshold" = s."threshold" AND p."appliedParameters" = s."appliedParameters"
        `,
        [payload],
    );
}

/**
 * Recomputes the denormalised summary counters
 * (migrations/risk/002_riskNarrow.sql §3) for the procurements this batch
 * touched, in the same transaction as the signals they describe — that is
 * what lets risk."vProcurementSummaries" project stored columns instead of
 * aggregating every signal row per read.
 *
 * Driven off the id list rather than off the signals, so a procurement whose
 * refresh produced no signals at all has its counters reset to zero instead
 * of keeping the previous run's.
 */
async function refreshCounters(client: PoolClient, decisionIds: readonly number[]): Promise<void> {
    await client.query(
        `
        UPDATE risk."procurementDecisions" d
        SET "triggeredCount"        = coalesce(c."triggered", 0),
            "notTriggeredCount"     = coalesce(c."notTriggered", 0),
            "insufficientDataCount" = coalesce(c."insufficientData", 0),
            "notApplicableCount"    = coalesce(c."notApplicable", 0),
            "triggeredIndicators"   = coalesce(c."triggeredIndicators", '{}'::smallint[])
        FROM unnest($1::int[]) AS touched("id")
                 LEFT JOIN (
            SELECT s."decisionId",
                   count(*) FILTER (WHERE st."code" = 'triggered')::smallint         AS "triggered",
                   count(*) FILTER (WHERE st."code" = 'not_triggered')::smallint     AS "notTriggered",
                   count(*) FILTER (WHERE st."code" = 'insufficient_data')::smallint AS "insufficientData",
                   count(*) FILTER (WHERE st."code" = 'not_applicable')::smallint    AS "notApplicable",
                   array_agg(DISTINCT s."indicator") FILTER (WHERE st."code" = 'triggered') AS "triggeredIndicators"
            FROM risk."signals" s
                     JOIN risk."signalStates" st ON st."id" = s."state"
            WHERE s."decisionId" = ANY ($1::int[])
            GROUP BY s."decisionId"
        ) c ON c."decisionId" = touched."id"
        WHERE d."id" = touched."id"
        `,
        [decisionIds],
    );
}

/**
 * The Decision Writer's raw SQL (risk-service-architecture.md §2.4): the
 * single place that turns a page's ProcurementRiskDecisions into rows.
 *
 * Indicator-independent — adding a Risk Indicator writes no SQL of its own.
 * Runs inside the caller's transaction, so a failing indicator contributes no
 * partial rows to the page.
 */
export async function writeDecisions(
    client: PoolClient,
    decisions: readonly ProcurementRiskDecisions[],
): Promise<WriteStats> {
    if (decisions.length === 0) {
        return { written: 0 };
    }

    // riskDecisionEngine.ts carries the analyst views' own `saltinis`; the
    // `risk` schema stores the camelCase code (riskCodes.ts).
    const payload = JSON.stringify(decisions.map(({ procurementSource, procurementId, dataAsOf, signals }) => ({
        procurementSource: riskProcurementSource(procurementSource),
        procurementId,
        dataAsOf,
        signals,
    })));

    await seedLookups(client, payload);
    const decisionIds = await upsertDecisions(client, payload);
    await client.query(`DELETE FROM risk."signals" WHERE "decisionId" = ANY ($1::int[])`, [decisionIds]);
    await insertSignals(client, payload);
    await refreshCounters(client, decisionIds);

    return { written: decisionIds.length };
}
