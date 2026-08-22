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
    private readonly procurementIndicators: readonly ARiskIndicatorDecision[];
    private readonly lotIndicators: readonly ARiskIndicatorDecision[];

    /**
     * `indicators` are already evaluation-scoped — each carries its own
     * fixed EvaluationContext (riskIndicatorDecision.ts), built by
     * RiskIndicatorRegistry.createAllIndicators(context)
     * (registry.ts) — so this class never builds or resolves a context
     * itself. Split by subjectType once here, so evaluateProcurement/
     * evaluateLot each walk only the indicators that apply to their subject.
     */
    constructor(indicators: readonly ARiskIndicatorDecision[]) {
        this.procurementIndicators = indicators.filter((indicator) => indicator.subjectType === "procurement");
        this.lotIndicators = indicators.filter((indicator) => indicator.subjectType === "lot");
    }

    /**
     * Walks every procurement (evaluateProcurement) and its lots
     * (evaluateLot) into one flat signal list. Each signal is already
     * validated and frozen by ARiskIndicatorDecision.signalFor
     * (riskIndicatorDecision.ts) at the moment it's built, so there's
     * nothing left for the Engine to do but collect them.
     */
    evaluateAll(procurements: readonly Procurement[]): readonly RiskSignal[] {
        const signals: RiskSignal[] = [];

        for (const procurement of procurements) {
            signals.push(...this.evaluateProcurement(procurement));
            for (const lot of procurement.lots) {
                signals.push(...this.evaluateLot(lot, procurement));
            }
        }

        return signals;
    }

    /** Every procurement-subjectType indicator's signal for this one procurement. */
    private evaluateProcurement(procurement: Procurement): RiskSignal[] {
        const subject = this.subjectForProcurement(procurement);
        const signals: RiskSignal[] = [];
        for (const indicator of this.procurementIndicators) {
            const signal = this.decide(indicator, subject);
            if (signal) signals.push(signal);
        }
        return signals;
    }

    /** Every lot-subjectType indicator's signal for this one lot. */
    private evaluateLot(lot: Lot, procurement: Procurement): RiskSignal[] {
        const subject = this.subjectForLot(lot, procurement);
        const signals: RiskSignal[] = [];
        for (const indicator of this.lotIndicators) {
            const signal = this.decide(indicator, subject);
            if (signal) signals.push(signal);
        }
        return signals;
    }

    /**
     * isEligible then, if eligible, assessRisk — the two-step protocol
     * riskIndicatorDecision.ts's RiskIndicatorDecision interface declares.
     * A failing indicator is contained to this one subject: logged, and
     * contributes nothing for it, rather than aborting the whole run.
     */
    private decide(indicator: ARiskIndicatorDecision, subject: Subject): RiskSignal | undefined {
        try {
            const outcome = indicator.isEligible(subject, indicator.context);
            return outcome.eligible ? indicator.assessRisk(subject, indicator.context) : outcome.signal;
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log(`riskDecisionEngine: ${indicator.id} failed for subject ${subject.subjectKey}: ${message}`);
            return undefined;
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
