import { postgres } from "../../postgres/postgres.js";
import { riskDb } from "../../postgres/riskDb.js";
import { log } from "../../utils/log.js";
import { PostgresRiskDataSource } from "../../modules/risk/riskDataSource.ts";
import { riskIndicatorRegistry } from "../../modules/risk/deployedIndicators.ts";
import { ProcurementReader } from "../../modules/risk/procurementReader.ts";
import { RiskDecisionEngine } from "../../modules/risk/riskDecisionEngine.ts";
import type { EvaluationRun } from "../../modules/risk/evaluationContext.ts";
import { SignalWriter } from "./signalWriter.ts";

export type RunJobOptions = Readonly<{
    codeCommit: string;
    subjects?: readonly string[] | null;
    // Rows per Procurement Reader page. See loadLotUniverse's comment in
    // procurementReader.ts for why this bounds evaluation+write working set,
    // not query count — lots/participation are still loaded once per run.
    pageSize?: number;
}>;

export type RunResult = Readonly<{
    runId: number;
    status: "succeeded" | "partial" | "failed";
    statistics: Record<string, unknown>;
}>;

const DEFAULT_PAGE_SIZE = 500;

type IndicatorStats = Readonly<{
    rows: number;
    triggered: number;
    inserted: number;
    ms: number;
    errors?: readonly string[];
}>;

/**
 * Accumulates one page's stats into the running per-indicator total. A
 * page's failure for indicator X must not erase an earlier page's
 * already-written success for X, and vice versa — risk.risk_signals is
 * insert-only, so a partially-written snapshot across pages is the expected,
 * documented shape (SignalWriter's "no crash recovery, no retry").
 */
function mergeIndicatorStats(
    into: Record<string, IndicatorStats>,
    indicatorId: string,
    page: { rows: number; triggered: number; inserted: number; ms: number; error?: string },
): void {
    const prev = into[indicatorId] ?? { rows: 0, triggered: 0, inserted: 0, ms: 0 };
    into[indicatorId] = {
        rows: prev.rows + page.rows,
        triggered: prev.triggered + page.triggered,
        inserted: prev.inserted + page.inserted,
        ms: prev.ms + page.ms,
        ...(page.error ? { errors: [...(prev.errors ?? []), page.error] } : prev.errors ? { errors: prev.errors } : {}),
    };
}

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

/**
 * Executes every active/shadow Risk Indicator against every page the
 * Procurement Reader loads (risk-service-architecture-v2.md §1.2): opens one
 * run, loops pages until nextCursor is null, evaluates each page's
 * Procurements through the RiskDecisionEngine, writes each page's signals,
 * and checkpoints per-indicator statistics after every page.
 *
 * A failing indicator is contained to its own rows within a page (see
 * RiskDecisionEngine) and its own write (caught separately below): it
 * contributes nothing for that page but the run continues, other indicators'
 * rows for that page are unaffected, and earlier pages' already-written rows
 * for the failing indicator stay written. The run closes as `partial` if any
 * page had any indicator error.
 */
export async function runEvaluation(options: RunJobOptions): Promise<RunResult> {
    await closeStaleRunningRuns();

    const dataAsOf = new Date().toISOString();
    const subjects = options.subjects ?? null;
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

    // Calculations read the real database's `public` canonical facts; only
    // the Signal Writer touches `riskDb`.
    const canonicalFacts = new PostgresRiskDataSource(postgres);
    const reader = new ProcurementReader(canonicalFacts, subjects, dataAsOf);
    const engine = new RiskDecisionEngine(riskIndicatorRegistry.evaluable());
    const writer = new SignalWriter(riskDb);

    const openedRun = await writer.updateEvaluationRun({
        status: "running",
        dataAsOf,
        codeCommit: options.codeCommit,
        statistics: {},
    });
    const evaluationRun: EvaluationRun = { runId: openedRun.runId, dataAsOf, subjects };

    const statistics: Record<string, IndicatorStats> = {};
    let anyFailed = false;
    let cursor: string | null = null;

    do {
        const page = await reader.loadProcurements(cursor, pageSize);
        const results = engine.evaluateAll(evaluationRun, page.items);

        for (const result of results) {
            let inserted = 0;
            let writeError: string | undefined;
            if (result.signals.length > 0) {
                try {
                    inserted = await writer.writeRiskSignals(result.signals);
                } catch (err) {
                    writeError = err instanceof Error ? err.message : String(err);
                }
            }

            mergeIndicatorStats(statistics, result.indicatorId, {
                rows: result.signals.length,
                triggered: result.signals.filter((s) => s.state === "triggered").length,
                inserted,
                ms: result.ms,
                error: result.error ?? writeError,
            });
            if (result.error || writeError) {
                anyFailed = true;
                log(`procurement-risk: ${result.indicatorId} failed on this page: ${result.error ?? writeError}`);
            }
        }

        await writer.updateEvaluationRun({ statistics });
        cursor = page.nextCursor;
    } while (cursor !== null);

    const status = anyFailed ? "partial" : "succeeded";
    const closed = await writer.updateEvaluationRun({ status, statistics });
    log(`procurement-risk: run ${closed.runId} ${status}`);
    return { runId: closed.runId, status, statistics };
}
