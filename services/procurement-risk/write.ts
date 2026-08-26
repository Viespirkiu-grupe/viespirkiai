import type { PoolClient } from "pg";
import type { ProcurementRiskDecisions, RiskSignal } from "../../modules/risk/types.ts";

export type WriteStats = Readonly<{ written: number }>;

/**
 * The Decision Writer's raw SQL (risk-service-architecture.md §2.4): the
 * single place that turns a page's ProcurementRiskDecisions into rows.
 *
 * `risk.risk_procurement_decisions` is current-state, not a snapshot: one row
 * per procurement, refreshed in place by `INSERT … ON CONFLICT DO UPDATE` on
 * the natural key (procurement_source, procurement_id) — metadata only, no
 * signals. `created_at` is deliberately left out of the `DO UPDATE SET` list,
 * so it only ever fires once, on first insert; `updated_at` advances on every
 * refresh.
 *
 * `risk.risk_signals` is wiped and reinserted whole per procurement, keyed to
 * its decisions row via `decision_id` (the id the upsert above returns) —
 * `DELETE FROM risk_signals WHERE decision_id = …` followed by a bulk
 * `INSERT`, never an `UPDATE`: a refresh re-evaluates every deployed
 * indicator for that procurement, so the replacement set is always
 * internally consistent.
 *
 * Indicator-independent: adding a Risk Indicator writes no SQL of its own.
 * Runs inside the caller's transaction, so a failing indicator contributes no
 * partial rows to the page.
 */
export async function writeDecisions(
    client: PoolClient,
    runId: number,
    decisions: readonly ProcurementRiskDecisions[],
): Promise<WriteStats> {
    if (decisions.length === 0) {
        return { written: 0 };
    }

    const { rows: upserted } = await client.query<{ id: string; procurement_source: string; procurement_id: string }>(
        `
        INSERT INTO risk.risk_procurement_decisions (
            procurement_source, procurement_id, run_id, data_as_of
        )
        SELECT "procurementSource", "procurementId", $2, "dataAsOf"::timestamptz
        FROM jsonb_to_recordset($1::jsonb) AS t(
            "procurementSource" text, "procurementId" text, "dataAsOf" text
        )
        ON CONFLICT (procurement_source, procurement_id) DO UPDATE SET
            run_id = excluded.run_id,
            data_as_of = excluded.data_as_of,
            updated_at = now()
        RETURNING id, procurement_source, procurement_id
        `,
        [
            JSON.stringify(decisions.map(({ procurementSource, procurementId, dataAsOf }) => ({ procurementSource, procurementId, dataAsOf }))),
            runId,
        ],
    );

    const decisionKey = (procurementSource: string, procurementId: string): string =>
        JSON.stringify([procurementSource, procurementId]);

    const decisionIdByProcurement = new Map(
        upserted.map((row) => [decisionKey(row.procurement_source, row.procurement_id), row.id]),
    );

    const decisionIds = upserted.map((row) => row.id);
    await client.query(`DELETE FROM risk.risk_signals WHERE decision_id = ANY($1::bigint[])`, [decisionIds]);

    const signalRows = decisions.flatMap((decision) => {
        const decisionId = decisionIdByProcurement.get(decisionKey(decision.procurementSource, decision.procurementId));
        return decision.signals.map((signal: RiskSignal) => ({ decisionId, ...signal }));
    });

    if (signalRows.length > 0) {
        await client.query(
            `
            INSERT INTO risk.risk_signals (
                decision_id, indicator_id, indicator_version, subject_type, subject_key,
                state, raw_value, threshold, applied_parameters, missing_data
            )
            SELECT "decisionId"::bigint, "indicatorId", "indicatorVersion", "subjectType", "subjectKey",
                   "state", "rawValue", "threshold", "appliedParameters", "missingData"
            FROM jsonb_to_recordset($1::jsonb) AS t(
                "decisionId" text, "indicatorId" text, "indicatorVersion" int, "subjectType" text, "subjectKey" text,
                "state" text, "rawValue" jsonb, "threshold" jsonb, "appliedParameters" jsonb, "missingData" text[]
            )
            `,
            [JSON.stringify(signalRows)],
        );
    }

    return { written: upserted.length };
}
