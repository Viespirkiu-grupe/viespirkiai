import type { PoolClient } from "pg";
import type { ProcurementRiskDecisions } from "../../modules/risk/types.ts";

export type WriteStats = Readonly<{ written: number }>;

/**
 * The Decision Writer's raw SQL (risk-service-architecture.md §2.4): the
 * single place that turns a page's ProcurementRiskDecisions into rows.
 *
 * `risk.risk_procurement_decisions` is current-state, not a snapshot: one row
 * per procurement, refreshed in place by `INSERT … ON CONFLICT DO UPDATE` on
 * the natural key (procurement_source, procurement_id). `signals` is replaced
 * whole — a refresh re-evaluates every deployed indicator for that
 * procurement, so the array is always internally consistent. `created_at` is
 * deliberately left out of the `DO UPDATE SET` list, so it only ever fires
 * once, on first insert; `updated_at` advances on every refresh.
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

    const { rowCount } = await client.query(
        `
        INSERT INTO risk.risk_procurement_decisions (
            procurement_source, procurement_id, run_id, signals, data_as_of
        )
        SELECT "procurementSource", "procurementId", $2, "signals"::jsonb, "dataAsOf"::timestamptz
        FROM jsonb_to_recordset($1::jsonb) AS t(
            "procurementSource" text, "procurementId" text, "signals" jsonb, "dataAsOf" text
        )
        ON CONFLICT (procurement_source, procurement_id) DO UPDATE SET
            run_id = excluded.run_id,
            signals = excluded.signals,
            data_as_of = excluded.data_as_of,
            updated_at = now()
        `,
        [JSON.stringify(decisions), runId],
    );

    return { written: rowCount ?? 0 };
}
