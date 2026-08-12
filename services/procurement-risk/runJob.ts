import { postgres } from "../../postgres/postgres.js";
import { riskDb } from "../../postgres/riskDb.js";
import { log } from "../../utils/log.js";
import { createEvaluationContext } from "../../modules/risk/evaluationContext.ts";
import { riskIndicatorRegistry } from "../../modules/risk/deployedIndicators.ts";
import { validateObservations } from "./validate.ts";
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
 * architecture.md §9): opens one run, evaluates each indicator against the
 * real database's `public` canonical facts, validates the rows, writes them
 * to the local risk DB, and records per-indicator statistics. A failing
 * indicator is contained — its previous signals stay current, and the run
 * continues to the next indicator.
 */
export async function runEvaluation(options: RunJobOptions): Promise<RunResult> {
    await closeStaleRunningRuns();

    const dataAsOf = new Date().toISOString();
    const runId = await openRun(dataAsOf, options.codeCommit);
    const subjects = options.subjects ?? null;
    const statistics: Record<string, unknown> = {};
    let anyFailed = false;

    for (const key of riskIndicatorRegistry.evaluableVersions()) {
        const indicator = riskIndicatorRegistry.require(key);
        const startedAt = Date.now();
        try {
            const parameters = riskIndicatorRegistry.parametersAsOf(key, dataAsOf);
            const ctx = createEvaluationContext(
                async (sqlText, params) => (await postgres.query(sqlText, params as unknown[])).rows,
                { runId, dataAsOf, parameters, subjects },
            );

            const rawObservations = await indicator.calculation(ctx);
            const observations = validateObservations(indicator, rawObservations);

            const client = await riskDb.connect();
            let writeStats;
            try {
                await client.query("BEGIN");
                writeStats = await writeObservations(client, key.id, runId, observations);
                await client.query("COMMIT");
            } catch (err) {
                await client.query("ROLLBACK");
                throw err;
            } finally {
                client.release();
            }

            statistics[key.id] = {
                rows: observations.length,
                triggered: observations.filter((o) => o.state === "triggered").length,
                ...writeStats,
                ms: Date.now() - startedAt,
            };
            log(`procurement-risk: ${key.id} — ${observations.length} rows, ${Date.now() - startedAt}ms`);
        } catch (err) {
            anyFailed = true;
            const message = err instanceof Error ? err.message : String(err);
            statistics[key.id] = { error: message, ms: Date.now() - startedAt };
            log(`procurement-risk: ${key.id} failed: ${message}`);
        }
    }

    const status = anyFailed ? "partial" : "succeeded";
    await closeRun(runId, status, statistics);
    return { runId, status, statistics };
}
