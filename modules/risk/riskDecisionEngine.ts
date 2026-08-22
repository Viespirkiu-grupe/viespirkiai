import { log } from "../../utils/log.js";
import type { ARiskIndicatorDecision } from "./riskIndicatorDecision.ts";
import type { Lot, Procurement, RiskSignal, Subject } from "./types.ts";

/**
 * The Risk Decision Engine
 * (docs/indicators-story/risk-service-architecture-v2.md §1.2): the only
 * place that loops indicators over the subject universe. A Risk Indicator's
 * own responsibility ends at isEligible(subject)/assessRisk(subject) — one
 * subject at a time (riskIndicatorDecision.ts); batching over every
 * procurement and lot, and assembling the run's signal list, belongs here.
 * Pure — no I/O — it only ever touches the already-loaded Procurements the
 * Procurement Reader (procurementReader.ts) handed it.
 */
export class RiskDecisionEngine {
    private readonly indicators: readonly ARiskIndicatorDecision[];

    /**
     * `indicators` are already evaluation-scoped — each carries its own
     * fixed EvaluationContext (riskIndicatorDecision.ts), built by
     * RiskIndicatorRegistry.createAllIndicators(context)
     * (registry.ts) — so this class never builds or resolves a context
     * itself.
     */
    constructor(indicators: readonly ARiskIndicatorDecision[]) {
        this.indicators = indicators;
    }

    /**
     * Walks every procurement (evaluateProcurement) and its lots
     * (evaluateLot), then validates each indicator's own observations once
     * at the end via ARiskIndicatorDecision.validateObservations —
     * identity/duplicate checks are the indicator's own concern, but only
     * meaningful over everything it decided this call, not one subject at a
     * time.
     */
    evaluateAll(procurements: readonly Procurement[]): readonly RiskSignal[] {
        const observationsByIndicator = new Map<ARiskIndicatorDecision, unknown[]>(
            this.indicators.map((indicator) => [indicator, []]),
        );

        for (const procurement of procurements) {
            this.evaluateProcurement(procurement, observationsByIndicator);
            for (const lot of procurement.lots) {
                this.evaluateLot(lot, procurement, observationsByIndicator);
            }
        }

        const signals: RiskSignal[] = [];
        for (const indicator of this.indicators) {
            signals.push(...indicator.validateObservations(observationsByIndicator.get(indicator)!));
        }
        return signals;
    }

    /** Every procurement-subjectType indicator's signal for this one procurement. */
    private evaluateProcurement(
        procurement: Procurement,
        observationsByIndicator: Map<ARiskIndicatorDecision, unknown[]>,
    ): void {
        const subject = this.subjectForProcurement(procurement);
        for (const indicator of this.indicators) {
            if (indicator.subjectType !== "procurement") continue;
            this.decide(indicator, subject, observationsByIndicator);
        }
    }

    /** Every lot-subjectType indicator's signal for this one lot. */
    private evaluateLot(
        lot: Lot,
        procurement: Procurement,
        observationsByIndicator: Map<ARiskIndicatorDecision, unknown[]>,
    ): void {
        const subject = this.subjectForLot(lot, procurement);
        for (const indicator of this.indicators) {
            if (indicator.subjectType !== "lot") continue;
            this.decide(indicator, subject, observationsByIndicator);
        }
    }

    /**
     * isEligible then, if eligible, assessRisk — the two-step protocol
     * riskIndicatorDecision.ts's RiskIndicatorDecision interface declares.
     * A failing indicator is contained to this one subject: logged, and
     * contributes nothing for it, rather than aborting the whole run.
     */
    private decide(
        indicator: ARiskIndicatorDecision,
        subject: Subject,
        observationsByIndicator: Map<ARiskIndicatorDecision, unknown[]>,
    ): void {
        try {
            const outcome = indicator.isEligible(subject, indicator.context);
            const signal = outcome.eligible ? indicator.assessRisk(subject, indicator.context) : outcome.signal;
            observationsByIndicator.get(indicator)!.push(signal);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`riskDecisionEngine: ${indicator.id} failed for subject ${subject.subjectKey}: ${message}`);
        }
    }

    private subjectForProcurement(procurement: Procurement): Subject {
        return {
            subjectType: "procurement",
            subjectKey: `${procurement.saltinis ?? "unknown"}:${procurement.pirkimoNumeris}`,
            procurementSource: procurement.saltinis,
            procurementId: procurement.pirkimoNumeris,
            procurement,
        };
    }

    private subjectForLot(lot: Lot, procurement: Procurement): Subject {
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
