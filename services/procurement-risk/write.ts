import type { PoolClient } from "pg";
import type { RiskObservationV1 } from "../../modules/risk/contracts.ts";

export type WriteStats = Readonly<{ inserted: number }>;

/**
 * The Risk Signals Writer (risk-service-architecture.md §6.2): the
 * single place that turns validated observations into rows.
 *
 * `risk.risk_signals` is insert-only. One run writes one immutable snapshot,
 * the site reads exactly one run, and superseded snapshots are deleted whole
 * by the retention job — so there is no current-state pointer to maintain, no
 * column comparison and nothing for a later run to modify. The `risk_rw` role
 * holds no UPDATE or DELETE on the table, so that is enforced rather than
 * merely intended.
 *
 * Indicator-independent: adding a Risk Indicator writes no SQL of its own.
 * Runs inside the caller's transaction, so a failing indicator contributes no
 * partial rows to the snapshot.
 */
export async function writeObservations(
    client: PoolClient,
    indicatorId: string,
    runId: number,
    observations: readonly RiskObservationV1[],
): Promise<WriteStats> {
    if (observations.length === 0) {
        return { inserted: 0 };
    }

    const { rowCount } = await client.query(
        `
        INSERT INTO risk.risk_signals (
            run_id, subject_type, subject_key, procurement_source, procurement_id,
            indicator_id, indicator_version, applied_parameters,
            state, raw_value, threshold, evidence, missing_data,
            data_as_of
        )
        SELECT $3, "subjectType", "subjectKey", "procurementSource", "procurementId",
               $2, "indicatorVersion", "appliedParameters",
               "state", "rawValue", "threshold", "evidence", "missingData",
               "dataAsOf"::timestamptz
        FROM jsonb_to_recordset($1::jsonb) AS t(
            "subjectType" text, "subjectKey" text, "procurementSource" text, "procurementId" text,
            "indicatorVersion" integer, "appliedParameters" jsonb,
            "state" text, "rawValue" jsonb, "threshold" jsonb, "evidence" jsonb, "missingData" jsonb,
            "dataAsOf" text
        )
        `,
        [JSON.stringify(observations), indicatorId, runId],
    );

    return { inserted: rowCount ?? 0 };
}
