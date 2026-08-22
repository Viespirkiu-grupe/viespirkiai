import { postgres } from "../../postgres/postgres.js";
import { riskDb } from "../../postgres/riskDb.js";
import { log } from "../../utils/log.js";
import { PostgresRiskDataSource } from "../../modules/risk/riskDataSource.ts";
import { riskIndicatorRegistry } from "../../modules/risk/deployedIndicators.ts";
import { ProcurementReader } from "../../modules/risk/procurementReader.ts";
import { RiskDecisionEngine } from "../../modules/risk/riskDecisionEngine.ts";
import { EvaluationContext } from "../../modules/risk/evaluationContext.ts";
import type { RiskSignal } from "../../modules/risk/types.ts";
import { SignalWriter } from "./signalWriter.ts";

export type RunJobOptions = Readonly<{
    codeCommit: string;
    subjects?: readonly string[] | null;
    // Rows per Procurement Reader page. See ensureLotUniverseLoaded's
    // comment in procurementReader.ts for why this bounds evaluation+write
    // working set, not query count — lots/participation are still loaded
    // once per run.
    pageSize?: number;
}>;

export type RunResult = Readonly<{
    runId: number;
    status: "succeeded" | "partial" | "failed";
    statistics: Record<string, unknown>;
}>;

const DEFAULT_PAGE_SIZE = 500;

type IndicatorStats = Readonly<{ rows: number; triggered: number; inserted: number }>;

/**
 * Groups one page's flat signal list by indicatorId and accumulates each
 * indicator's rows/triggered/inserted into the running per-indicator total.
 * RiskDecisionEngine.evaluateAll (riskDecisionEngine.ts) already isolates a
 * failing indicator's own computation per subject — it just contributes no
 * signal for that subject, logged, not surfaced here — so the only failure
 * this job itself still observes is a page's write failing as a whole (see
 * writePage below), which is why `inserted` can differ from `rows`.
 */
function mergeIndicatorStats(
    into: Record<string, IndicatorStats>,
    pageSignals: readonly RiskSignal[],
    inserted: boolean,
): void {
    const byIndicator = new Map<string, RiskSignal[]>();
    for (const signal of pageSignals) {
        const bucket = byIndicator.get(signal.indicatorId) ?? [];
        bucket.push(signal);
        byIndicator.set(signal.indicatorId, bucket);
    }

    for (const [indicatorId, signals] of byIndicator) {
        const prev = into[indicatorId] ?? { rows: 0, triggered: 0, inserted: 0 };
        into[indicatorId] = {
            rows: prev.rows + signals.length,
            triggered: prev.triggered + signals.filter((s) => s.state === "triggered").length,
            inserted: prev.inserted + (inserted ? signals.length : 0),
        };
    }
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
 * Executes every Risk Indicator whose parameter timeline is in force as of
 * `dataAsOf` against every page the Procurement Reader loads
 * (risk-service-architecture-v2.md §1.2): opens one
 * run, loops pages until nextCursor is null, evaluates each page's
 * Procurements through the RiskDecisionEngine (one flat signal list per
 * page, spanning every indicator), writes that page's signals in one
 * transaction, and checkpoints per-indicator statistics after every page.
 *
 * Per-indicator computation failures are contained by RiskDecisionEngine
 * itself (logged, that subject's signal just doesn't appear) and never reach
 * this job. What this job still isolates is a page's *write* failing as a
 * whole — the run closes `partial`, not `failed`, so already-written pages
 * for this and other runs stay untouched (risk.risk_signals is insert-only).
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
    const writer = new SignalWriter(riskDb);

    const openedRun = await writer.updateEvaluationRun({
        status: "running",
        dataAsOf,
        codeCommit: options.codeCommit,
        statistics: {},
    });
    const evaluationContext = new EvaluationContext({ runId: openedRun.runId, dataAsOf });
    const engine = new RiskDecisionEngine(riskIndicatorRegistry.createAllIndicators(evaluationContext));

    const statistics: Record<string, IndicatorStats> = {};
    let anyFailed = false;
    let cursor: string | null = null;

    do {
        const page = await reader.loadProcurements(cursor, pageSize);
        const signals = engine.evaluateAll(page.items);

        let inserted = true;
        if (signals.length > 0) {
            try {
                await writer.writeRiskSignals(signals);
            } catch (err) {
                inserted = false;
                anyFailed = true;
                const message = err instanceof Error ? err.message : String(err);
                log(`procurement-risk: failed writing a page's signals: ${message}`);
            }
        }

        mergeIndicatorStats(statistics, signals, inserted);
        await writer.updateEvaluationRun({ statistics });
        cursor = page.nextCursor;
    } while (cursor !== null);

    const status = anyFailed ? "partial" : "succeeded";
    const closed = await writer.updateEvaluationRun({ status, statistics });
    log(`procurement-risk: run ${closed.runId} ${status}`);
    return { runId: closed.runId, status, statistics };
}
