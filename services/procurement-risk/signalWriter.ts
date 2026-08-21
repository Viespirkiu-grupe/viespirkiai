import type { Pool, PoolClient } from "pg";
import type { RiskSignal } from "../../modules/risk/types.ts";
import { writeObservations } from "./write.ts";

export type RunStatus = "running" | "succeeded" | "partial" | "failed";

export type EvaluationRun = Readonly<{
    runId: number;
    status: RunStatus;
    dataAsOf: string;
    codeCommit: string;
    statistics: Record<string, unknown>;
}>;

/**
 * The Signal Writer (docs/indicators-story/risk-service-architecture-v2.md
 * §1.2): wraps write.ts's indicator-independent writeObservations() with the
 * run lifecycle. One instance per run.
 *
 * updateEvaluationRun upserts: the first call (no run open yet) INSERTs the
 * risk.evaluation_runs row; every later call UPDATEs it — accumulating
 * per-indicator stats across pages as services/procurement-risk/runJob.ts
 * loops the Procurement Reader's pages. No crash recovery, no retry: a
 * process crash mid-run leaves the row 'running', closed as 'failed' by
 * runJob.ts's closeStaleRunningRuns() on the next process start.
 */
export class SignalWriter {
    private readonly pool: Pool;
    private evaluationRun: EvaluationRun | null = null;

    constructor(pool: Pool) {
        this.pool = pool;
    }

    get runId(): number {
        if (this.evaluationRun === null) {
            throw new Error("SignalWriter: no run open yet — call updateEvaluationRun first");
        }
        return this.evaluationRun.runId;
    }

    /** One DB transaction per call. */
    async writeRiskSignals(signals: readonly RiskSignal[]): Promise<number> {
        const client: PoolClient = await this.pool.connect();
        try {
            await client.query("BEGIN");
            const { inserted } = await writeObservations(client, this.runId, signals);
            await client.query("COMMIT");
            return inserted;
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
                `INSERT INTO risk.evaluation_runs (data_as_of, code_commit, status, statistics)
                 VALUES ($1, $2, $3, $4) RETURNING id`,
                [update.dataAsOf, update.codeCommit, update.status ?? "running", JSON.stringify(update.statistics ?? {})],
            );
            this.evaluationRun = {
                runId: rows[0].id,
                status: update.status ?? "running",
                dataAsOf: update.dataAsOf!,
                codeCommit: update.codeCommit!,
                statistics: update.statistics ?? {},
            };
            return this.evaluationRun;
        }

        const merged: EvaluationRun = { ...this.evaluationRun, ...update };
        await this.pool.query(
            `UPDATE risk.evaluation_runs
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
