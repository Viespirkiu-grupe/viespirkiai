import { postgres } from "../../postgres/postgres.js";
import { riskDb } from "../../postgres/riskDb.js";
import { log } from "../../utils/log.js";
import { PostgresRiskDataSource } from "../../modules/risk/riskDataSource.ts";
import { riskIndicatorRegistry } from "../../modules/risk/deployedIndicators.ts";
import { ProcurementReader } from "../../modules/risk/procurementReader.ts";
import { RiskDecisionEngine } from "../../modules/risk/riskDecisionEngine.ts";
import { EvaluationContext } from "../../modules/risk/evaluationContext.ts";
import type { IndicatorStats, ProcurementRiskDecisions, RunStatistics, RunTotals } from "../../modules/risk/types.ts";
import { DecisionWriter } from "./decisionWriter.ts";

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
    statistics: RunStatistics;
}>;

const DEFAULT_PAGE_SIZE = 500;

/**
 * Groups one page's ProcurementRiskDecisions by indicatorId (via their own
 * signals) and accumulates each indicator's rows/triggered/written into the
 * running per-indicator total. RiskDecisionEngine.evaluateAll
 * (riskDecisionEngine.ts) already isolates a failing indicator's own
 * computation per subject — it just contributes no signal for that subject,
 * logged, not surfaced here — so the only failure this job itself still
 * observes is a page's write failing as a whole (see the write attempt in
 * runEvaluation below), which is why `written` can differ from `rows`.
 */
function mergeIndicatorStats(
    into: Record<string, IndicatorStats>,
    pageDecisions: readonly ProcurementRiskDecisions[],
    written: boolean,
): void {
    const byIndicator = new Map<string, number>();
    const triggeredByIndicator = new Map<string, number>();
    for (const decision of pageDecisions) {
        for (const signal of decision.signals) {
            byIndicator.set(signal.indicatorId, (byIndicator.get(signal.indicatorId) ?? 0) + 1);
            if (signal.state === "triggered") {
                triggeredByIndicator.set(signal.indicatorId, (triggeredByIndicator.get(signal.indicatorId) ?? 0) + 1);
            }
        }
    }

    for (const [indicatorId, rows] of byIndicator) {
        const prev = into[indicatorId] ?? { rows: 0, triggered: 0, written: 0 };
        into[indicatorId] = {
            rows: prev.rows + rows,
            triggered: prev.triggered + (triggeredByIndicator.get(indicatorId) ?? 0),
            written: prev.written + (written ? rows : 0),
        };
    }
}

function sumIndicatorField(indicators: Readonly<Record<string, IndicatorStats>>, field: keyof IndicatorStats): number {
    let total = 0;
    for (const stats of Object.values(indicators)) total += stats[field];
    return total;
}

// Rounded to one decimal place — the checkpoint cadence (once per page) is
// far coarser than a millisecond ever needs to be surfaced at.
function elapsedSec(startedAt: number): number {
    return Math.round((Date.now() - startedAt) / 100) / 10;
}

/**
 * Assembles the run-wide RunTotals (types.ts) that sit alongside the
 * per-indicator breakdown — signalsEvaluated/Triggered/Written are derived
 * from that breakdown (a signal row is always exactly one indicator's), so
 * there's nothing to track separately for those three; everything else
 * (procurements, pages, orphan lots, wall time) has no per-indicator
 * equivalent and is counted directly by the loop below.
 */
function buildStatistics(
    indicators: Readonly<Record<string, IndicatorStats>>,
    counters: Readonly<{
        procurementsEvaluated: number;
        decisionsWritten: number;
        orphanLotsDropped: number;
        pagesProcessed: number;
        pagesFailed: number;
        durationSec: number;
    }>,
): RunStatistics {
    const totals: RunTotals = {
        ...counters,
        signalsEvaluated: sumIndicatorField(indicators, "rows"),
        signalsTriggered: sumIndicatorField(indicators, "triggered"),
        signalsWritten: sumIndicatorField(indicators, "written"),
    };
    return { totals, indicators };
}

/**
 * Closes any run left `running` by a previous crash. The partial unique
 * index on `status = 'running'` (risk-schema.md §1) is the database-enforced
 * backstop to the advisory lock this only needs to run once per process
 * start, before opening a new run.
 */
async function closeStaleRunningRuns(): Promise<void> {
    const { rowCount } = await riskDb.query(
        `UPDATE risk.risk_evaluation_runs
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
 * (risk-service-architecture.md §1.2): opens one run, loops pages until
 * nextCursor is null, evaluates each page's Procurements through the
 * RiskDecisionEngine (one ProcurementRiskDecisions per procurement, spanning
 * every indicator), upserts that page's decisions in one transaction, and
 * checkpoints run-wide totals plus per-indicator statistics (types.ts's
 * RunStatistics) after every page.
 *
 * Per-indicator computation failures are contained by RiskDecisionEngine
 * itself (logged, that subject's signal just doesn't appear) and never reach
 * this job. What this job still isolates is a page's *write* failing as a
 * whole — the run closes `partial`, not `failed`; every other page's rows,
 * from this and other runs, stay untouched (a refresh is scoped to the
 * procurements it actually re-evaluates).
 */
export async function runEvaluation(options: RunJobOptions): Promise<RunResult> {
    await closeStaleRunningRuns();

    const startedAt = Date.now();
    const dataAsOf = new Date().toISOString();
    const subjects = options.subjects ?? null;
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;

    // Calculations read the real database's `public` canonical facts; only
    // the Decision Writer touches `riskDb`.
    const canonicalFacts = new PostgresRiskDataSource(postgres);
    const reader = new ProcurementReader(canonicalFacts, subjects, dataAsOf);
    const writer = new DecisionWriter(riskDb);

    const openedRun = await writer.updateEvaluationRun({
        status: "running",
        dataAsOf,
        codeCommit: options.codeCommit,
    });
    const evaluationContext = new EvaluationContext({ runId: openedRun.runId, dataAsOf });
    const engine = new RiskDecisionEngine(riskIndicatorRegistry.createAllIndicators(evaluationContext), evaluationContext);

    const indicatorStats: Record<string, IndicatorStats> = {};
    let procurementsEvaluated = 0;
    let decisionsWritten = 0;
    let pagesProcessed = 0;
    let pagesFailed = 0;
    let anyFailed = false;
    let cursor: string | null = null;

    do {
        const page = await reader.loadProcurements(cursor, pageSize);
        const decisions = engine.evaluateAll(page.items);
        pagesProcessed++;
        procurementsEvaluated += decisions.length;

        let written = true;
        if (decisions.length > 0) {
            try {
                await writer.writeDecisions(decisions);
                decisionsWritten += decisions.length;
            } catch (err) {
                written = false;
                anyFailed = true;
                pagesFailed++;
                const message = err instanceof Error ? err.message : String(err);
                log(`procurement-risk: failed writing a page's decisions: ${message}`);
            }
        }

        mergeIndicatorStats(indicatorStats, decisions, written);
        const statistics = buildStatistics(indicatorStats, {
            procurementsEvaluated,
            decisionsWritten,
            orphanLotsDropped: reader.droppedOrphanLotCount,
            pagesProcessed,
            pagesFailed,
            durationSec: elapsedSec(startedAt),
        });
        await writer.updateEvaluationRun({ statistics });
        cursor = page.nextCursor;
    } while (cursor !== null);

    const status = anyFailed ? "partial" : "succeeded";
    const statistics = buildStatistics(indicatorStats, {
        procurementsEvaluated,
        decisionsWritten,
        orphanLotsDropped: reader.droppedOrphanLotCount,
        pagesProcessed,
        pagesFailed,
        durationSec: elapsedSec(startedAt),
    });
    const closed = await writer.updateEvaluationRun({ status, statistics });
    log(`procurement-risk: run ${closed.runId} ${status}`);
    return { runId: closed.runId, status, statistics };
}
