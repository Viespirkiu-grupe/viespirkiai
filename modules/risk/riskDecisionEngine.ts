import type { EvaluationRun } from "./evaluationContext.ts";
import type { ARiskIndicatorDecision } from "./riskIndicatorDecision.ts";
import type { Lot, Procurement, RiskSignal, Subject } from "./types.ts";

export type IndicatorEvaluationResult = Readonly<{
    indicatorId: string;
    signals: readonly RiskSignal[];
    error?: string;
    ms: number;
}>;

/**
 * Pure evaluation logic — no I/O. Receives one page of already-loaded
 * Procurements (Procurement Reader, procurementReader.ts) and the deployed
 * indicators, and decides every subject of every indicator's own
 * subjectType. See docs/indicators-story/risk-service-architecture-v2.md
 * §1.2.
 *
 * Loops indicators as the outer/error-isolation dimension: one
 * `indicator.evaluate(run, subjects)` call per indicator, catching its own
 * failure so it contributes no signals for this page without stopping the
 * others (services/procurement-risk/runJob.ts then merges per-indicator
 * stats/errors across pages). This preserves ARiskIndicatorDecision's
 * existing batch contract — duplicate-subject rejection and one
 * validateObservations() call per indicator — rather than the alternative of
 * decomposing per subject, which would require re-implementing that
 * contract here.
 */
export class RiskDecisionEngine {
    private readonly indicators: readonly ARiskIndicatorDecision[];

    constructor(indicators: readonly ARiskIndicatorDecision[]) {
        this.indicators = indicators;
    }

    evaluateAll(run: EvaluationRun, procurements: readonly Procurement[]): readonly IndicatorEvaluationResult[] {
        const subjects = this.subjectsFor(procurements);

        return this.indicators.map((indicator) => {
            const startedAt = Date.now();
            try {
                const signals = indicator.evaluate(run, subjects);
                return { indicatorId: indicator.id, signals, ms: Date.now() - startedAt };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                return { indicatorId: indicator.id, signals: [], error: message, ms: Date.now() - startedAt };
            }
        });
    }

    /**
     * Builds the flat Subject universe for one page: one ProcurementSubject
     * per procurement, one LotSubject per lot — each lot's parent is the
     * procurement it came nested under, never null (types.ts's LotSubject).
     */
    private subjectsFor(procurements: readonly Procurement[]): readonly Subject[] {
        return procurements.flatMap((procurement) => [
            this.evaluateProcurement(procurement),
            ...procurement.lots.map((lot) => this.evaluateLot(lot, procurement)),
        ]);
    }

    private evaluateProcurement(procurement: Procurement): Subject {
        return {
            subjectType: "procurement",
            subjectKey: `${procurement.saltinis ?? "unknown"}:${procurement.pirkimoNumeris}`,
            procurementSource: procurement.saltinis,
            procurementId: procurement.pirkimoNumeris,
            procurement,
        };
    }

    private evaluateLot(lot: Lot, procurement: Procurement): Subject {
        return {
            subjectType: "lot",
            subjectKey: lot.subjektoRaktas,
            procurementSource: lot.saltinis,
            procurementId: lot.pirkimoNumeris,
            lot,
            procurement,
        };
    }
}
