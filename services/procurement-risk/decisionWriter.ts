import type { Pool, PoolClient } from "pg";
import { EMPTY_RUN_STATISTICS, type EvaluationRun, type ProcurementRiskDecisions } from "../../modules/risk/types.ts";
import { writeDecisions } from "./write.ts";

/**
 * The Decision Writer (docs/indicators-story/risk-service-architecture.md
 * §1.2): wraps write.ts's indicator-independent writeDecisions() with the
 * run lifecycle. One instance per run.
 *
 * updateEvaluationRun upserts: the first call (no run open yet) INSERTs the
 * risk.risk_evaluation_runs row; every later call UPDATEs it — accumulating
 * per-indicator stats across pages as services/procurement-risk/runJob.ts
 * loops the Procurement Reader's pages. No crash recovery, no retry: a
 * process crash mid-run leaves the row 'running', closed as 'failed' by
 * runJob.ts's closeStaleRunningRuns() on the next process start.
 */
export class DecisionWriter {
    private readonly pool: Pool;
    private evaluationRun: EvaluationRun | null = null;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    get runId(): number {
        if (this.evaluationRun === null) {
            throw new Error("DecisionWriter: no run open yet — call updateEvaluationRun first");
        }
        return this.evaluationRun.runId;
    }

    /** One DB transaction per call. */
    async writeDecisions(decisions: readonly ProcurementRiskDecisions[]): Promise<number> {
        const client: PoolClient = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const { written } = await writeDecisions(client, this.runId, decisions);
            await client.query("COMMIT");
            return written;
        } catch (err) {
            await client.query("ROLLBACK");
            throw err;
        } finally {
            client.release();
        }
    }

    async updateEvaluationRun(update: Partial<Omit<EvaluationRun, "runId">>): Promise<EvaluationRun> {
        if (this.evaluationRun === null) {
            const { rows } = await this.pool.query<{ id: number }>(
                `INSERT INTO risk.risk_evaluation_runs (data_as_of, status, statistics)
                 VALUES ($1, $2, $3) RETURNING id`,
                [update.dataAsOf, update.status ?? "running", JSON.stringify(update.statistics ?? EMPTY_RUN_STATISTICS)],
            );
            this.evaluationRun = {
                runId: rows[0].id,
                status: update.status ?? "running",
                dataAsOf: update.dataAsOf!,
                statistics: update.statistics ?? EMPTY_RUN_STATISTICS,
            };
            return this.evaluationRun;
        }

        const merged: EvaluationRun = { ...this.evaluationRun, ...update };
        await this.pool.query(
            `UPDATE risk.risk_evaluation_runs
             SET status = $2,
                 finished_at = CASE WHEN $2 IN ('succeeded', 'partial', 'failed') THEN now() ELSE finished_at END,
                 statistics = $3
             WHERE id = $1`,
            [merged.runId, merged.status, JSON.stringify(merged.statistics)],
        );
        this.evaluationRun = merged;
        return merged;
    }
}
