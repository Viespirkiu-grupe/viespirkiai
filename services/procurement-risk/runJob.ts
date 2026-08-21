import { postgres } from "../../postgres/postgres.js";
import { riskDb } from "../../postgres/riskDb.js";
import { log } from "../../utils/log.js";
import { PostgresRiskDataSource } from "../../modules/risk/riskDataSource.ts";
import { riskIndicatorRegistry } from "../../modules/risk/deployedIndicators.ts";
import { loadProcurements } from "../../modules/risk/procurementReader.ts";
import type { Subject } from "../../modules/risk/types.ts";
import { writeObservations } from "./write.ts";

export type RunJobOptions = Readonly<{
    codeCommit: string;
    subjects?: readonly string[] | null;
}>;

export type RunResult = Readonly<{
    runId: number;
    status: "succeeded" | "partial" | "failed";
    statistics: Record<string, unknown>;
}>;

/**
 * Closes any run left `running` by a previous crash. The partial unique
 * index on `status = 'running'` (risk-schema.md §1) is the database-enforced
 * backstop to the advisory lock this only needs to run once per process
 * start, before opening a new run.
 */
async function closeStaleRunningRuns(): Promise<void> {
    const { rowCount } = await riskDb.query(
        `UPDATE risk.evaluation_runs
         SET status = 'failed', finished_at = now(), error = 'closed at next service start: run left running'
         WHERE status = 'running'`,
    );
    if (rowCount) {
        log(`procurement-risk: closed ${rowCount} stale running run(s) from a previous crash`);
    }
}

async function openRun(dataAsOf: string, codeCommit: string): Promise<number> {
    const { rows } = await riskDb.query<{ id: number }>(
        `INSERT INTO risk.evaluation_runs (data_as_of, code_commit, status)
         VALUES ($1, $2, 'running')
         RETURNING id`,
        [dataAsOf, codeCommit],
    );
    return rows[0].id;
}

async function closeRun(runId: number, status: "succeeded" | "partial", statistics: Record<string, unknown>): Promise<void> {
    await riskDb.query(
        `UPDATE risk.evaluation_runs
         SET status = $2, finished_at = now(), statistics = $3
         WHERE id = $1`,
        [runId, status, JSON.stringify(statistics)],
    );
}

/**
 * Executes every active Risk Indicator one at a time (risk-service-
 * architecture.md §5): opens one run, evaluates each indicator against the
 * real database's `public` canonical facts, validates the rows, appends them
 * to the run's snapshot, and records per-indicator statistics.
 *
 * A failing indicator is contained to its own rows: it contributes nothing to
 * this snapshot and the run continues, so the site shows that indicator as not
 * evaluated in the current run rather than showing a stale result beside fresh
 * ones. The run closes as `partial`, which `statistics` explains per indicator.
 */
export async function runEvaluation(options: RunJobOptions): Promise<RunResult> {
    await closeStaleRunningRuns();

    const dataAsOf = new Date().toISOString();
    const runId = await openRun(dataAsOf, options.codeCommit);
    const run = { runId, dataAsOf, subjects: options.subjects ?? null };
    // Calculations read the real database's `public` canonical facts; only
    // the Risk Signals Writer touches `riskDb`.
    const canonicalFacts = new PostgresRiskDataSource(postgres);

    // Procurement Reader (risk-service-architecture-v2.md §1): one pass per
    // run, not per indicator — every indicator below decides against the
    // same loaded subject universe.
    const { procurementSubjects, lotSubjects } = await loadProcurements(canonicalFacts, run.subjects);
    const subjects: readonly Subject[] = [...procurementSubjects, ...lotSubjects];

    const statistics: Record<string, unknown> = {};
    let anyFailed = false;

    for (const indicator of riskIndicatorRegistry.evaluable()) {
        const startedAt = Date.now();
        try {
            const observations = await indicator.evaluate(run, subjects, canonicalFacts);

            const client = await riskDb.connect();
            let writeStats;
            try {
                await client.query("BEGIN");
                writeStats = await writeObservations(client, indicator.id, runId, observations);
                await client.query("COMMIT");
            } catch (err) {
                await client.query("ROLLBACK");
                throw err;
            } finally {
                client.release();
            }

            statistics[indicator.id] = {
                rows: observations.length,
                triggered: observations.filter((o) => o.state === "triggered").length,
                ...writeStats,
                ms: Date.now() - startedAt,
            };
            log(`procurement-risk: ${indicator.id} — ${observations.length} rows, ${Date.now() - startedAt}ms`);
        } catch (err) {
            anyFailed = true;
            const message = err instanceof Error ? err.message : String(err);
            statistics[indicator.id] = { error: message, ms: Date.now() - startedAt };
            log(`procurement-risk: ${indicator.id} failed: ${message}`);
        }
    }

    const status = anyFailed ? "partial" : "succeeded";
    await closeRun(runId, status, statistics);
    return { runId, status, statistics };
}
