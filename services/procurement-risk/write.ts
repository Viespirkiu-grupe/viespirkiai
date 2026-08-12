import type { PoolClient } from "pg";
import type { RiskObservationV1 } from "../../modules/risk/contracts.ts";

export type WriteStats = Readonly<{ closed: number; inserted: number; unchanged: number }>;

/**
 * The Risk Signals Writer (risk-service-architecture.md §7.2 / §5.6): the
 * single place that owns valid_from/valid_to/checked_at and the
 * close-and-append rule. Indicator-independent — takes validated
 * observations and issues generic statements, so adding a Risk Indicator
 * writes no INSERT/UPDATE of its own.
 *
 * Runs inside the caller's transaction so a failing indicator's writes never
 * partially land.
 */
export async function writeObservations(
    client: PoolClient,
    indicatorId: string,
    runId: number,
    observations: readonly RiskObservationV1[],
): Promise<WriteStats> {
    // Advance checked_at on every current row of this indicator — the
    // largest write a run performs, and what lets "checked last night,
    // unchanged" read differently from "not checked since March".
    await client.query(`UPDATE risk.risk_signals SET checked_at = now() WHERE indicator_id = $1 AND valid_to IS NULL`, [
        indicatorId,
    ]);

    if (observations.length === 0) {
        return { closed: 0, inserted: 0, unchanged: 0 };
    }

    // Column-compare against the current row, IS DISTINCT FROM so a NULL
    // appearing/disappearing on either side counts as a change.
    const { rows: changed } = await client.query<RiskObservationV1>(
        `
        WITH incoming AS (
            SELECT *
            FROM jsonb_to_recordset($1::jsonb) AS t(
                "indicatorId" text, "indicatorVersion" integer, "subjectType" text, "subjectKey" text,
                "procurementSource" text, "procurementId" text, "state" text,
                "rawValue" jsonb, "threshold" jsonb, "appliedParameters" jsonb, "evidence" jsonb,
                "missingData" jsonb, "dataAsOf" text
            )
        ),
        current AS (
            SELECT * FROM risk.risk_signals WHERE indicator_id = $2 AND valid_to IS NULL
        )
        SELECT incoming.*
        FROM incoming
                 LEFT JOIN current
                           ON current.subject_type = incoming."subjectType"
                               AND current.subject_key = incoming."subjectKey"
        WHERE current.id IS NULL
           OR current.indicator_version IS DISTINCT FROM incoming."indicatorVersion"
           OR current.applied_parameters IS DISTINCT FROM incoming."appliedParameters"
           OR current.state IS DISTINCT FROM incoming."state"
           OR current.raw_value IS DISTINCT FROM incoming."rawValue"
           OR current.threshold IS DISTINCT FROM incoming."threshold"
           OR current.evidence IS DISTINCT FROM incoming."evidence"
           OR current.missing_data IS DISTINCT FROM incoming."missingData"
        `,
        [JSON.stringify(observations), indicatorId],
    );

    if (changed.length === 0) {
        return { closed: 0, inserted: 0, unchanged: observations.length };
    }

    const subjectTypes = changed.map((r) => r.subjectType);
    const subjectKeys = changed.map((r) => r.subjectKey);

    await client.query(
        `
        UPDATE risk.risk_signals AS s
        SET valid_to = now()
        FROM unnest($1::text[], $2::text[]) AS c (subject_type, subject_key)
        WHERE s.indicator_id = $3
          AND s.valid_to IS NULL
          AND s.subject_type = c.subject_type
          AND s.subject_key = c.subject_key
        `,
        [subjectTypes, subjectKeys, indicatorId],
    );

    await client.query(
        `
        INSERT INTO risk.risk_signals (
            subject_type, subject_key, procurement_source, procurement_id,
            indicator_id, indicator_version, applied_parameters,
            state, raw_value, threshold, evidence, missing_data,
            data_as_of, run_id
        )
        SELECT "subjectType", "subjectKey", "procurementSource", "procurementId",
               $2, "indicatorVersion", "appliedParameters",
               "state", "rawValue", "threshold", "evidence", "missingData",
               "dataAsOf"::timestamptz, $3
        FROM jsonb_to_recordset($1::jsonb) AS t(
            "subjectType" text, "subjectKey" text, "procurementSource" text, "procurementId" text,
            "indicatorVersion" integer, "appliedParameters" jsonb,
            "state" text, "rawValue" jsonb, "threshold" jsonb, "evidence" jsonb, "missingData" jsonb,
            "dataAsOf" text
        )
        `,
        [JSON.stringify(changed), indicatorId, runId],
    );

    return { closed: changed.length, inserted: changed.length, unchanged: observations.length - changed.length };
}
