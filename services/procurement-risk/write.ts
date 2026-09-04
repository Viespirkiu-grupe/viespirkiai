import type { PoolClient } from "pg";
import type { ProcurementRiskDecisions, RiskSignal } from "../../modules/risk/types.ts";

export type WriteStats = Readonly<{ written: number }>;

/**
 * The Decision Writer's raw SQL (risk-service-architecture.md §2.4): the
 * single place that turns a page's ProcurementRiskDecisions into rows.
 *
 * `risk."procurementDecisions"` is current-state, not a snapshot: one row
 * per procurement, refreshed in place by `INSERT … ON CONFLICT DO UPDATE` on
 * the natural key ("procurementSource", "procurementId") — metadata only, no
 * signals. `"createdAt"` is deliberately left out of the `DO UPDATE SET` list,
 * so it only ever fires once, on first insert; `"updatedAt"` advances on every
 * refresh.
 *
 * `risk."signals"` is wiped and reinserted whole per procurement, keyed to
 * its decisions row via `"decisionId"` (the id the upsert above returns) —
 * `DELETE FROM risk."signals" WHERE "decisionId" = …` followed by a bulk
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
    decisions: readonly ProcurementRiskDecisions[],
): Promise<WriteStats> {
    if (decisions.length === 0) {
        return { written: 0 };
    }

    const { rows: upserted } = await client.query<{ id: string; procurementSource: string; procurementId: string }>(
        `
        INSERT INTO risk."procurementDecisions" (
            "procurementSource", "procurementId", "dataAsOf"
        )
        SELECT "procurementSource", "procurementId", "dataAsOf"::timestamptz
        FROM jsonb_to_recordset($1::jsonb) AS t(
            "procurementSource" text, "procurementId" text, "dataAsOf" text
        )
        ON CONFLICT ("procurementSource", "procurementId") DO UPDATE SET
            "dataAsOf" = excluded."dataAsOf",
            "updatedAt" = now()
        RETURNING "id", "procurementSource", "procurementId"
        `,
        [
            JSON.stringify(decisions.map(({ procurementSource, procurementId, dataAsOf }) => ({ procurementSource, procurementId, dataAsOf }))),
        ],
    );

    const decisionKey = (procurementSource: string, procurementId: string): string =>
        JSON.stringify([procurementSource, procurementId]);

    const decisionIdByProcurement = new Map(
        upserted.map((row) => [decisionKey(row.procurementSource, row.procurementId), row.id]),
    );

    const decisionIds = upserted.map((row) => row.id);
    await client.query(`DELETE FROM risk."signals" WHERE "decisionId" = ANY($1::bigint[])`, [decisionIds]);

    const signalRows = decisions.flatMap((decision) => {
        const decisionId = decisionIdByProcurement.get(decisionKey(decision.procurementSource, decision.procurementId));
        return decision.signals.map((signal: RiskSignal) => ({ decisionId, ...signal }));
    });

    if (signalRows.length > 0) {
        await client.query(
            `
            INSERT INTO risk."signals" (
                "decisionId", "indicatorId", "indicatorVersion", "subjectType", "subjectKey",
                "state", "rawValue", "threshold", "appliedParameters", "missingData"
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
