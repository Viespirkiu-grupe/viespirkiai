import { log } from "../../utils/log.js";
import { EvaluationContext, type EvaluationRun } from "./evaluationContext.ts";
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

    constructor(indicators: readonly ARiskIndicatorDecision[]) {
        this.indicators = indicators;
    }

    /**
     * `run` carries the cutoff an EvaluationContext needs to resolve each
     * indicator's effective parameters against — the run's cutoff, not any
     * one subject's.
     *
     * Builds one EvaluationContext per indicator up front — dataAsOf-effective
     * parameters depend only on the indicator and the run, never on which
     * subject is being decided, so this is done once per call, not once per
     * subject. Then walks every procurement (evaluateProcurement) and its
     * lots (evaluateLot), and validates each indicator's own observations
     * once at the end via ARiskIndicatorDecision.validateObservations —
     * identity/duplicate checks are the indicator's own concern, but only
     * meaningful over everything it decided this call, not one subject at a
     * time.
     */
    evaluateAll(run: EvaluationRun, procurements: readonly Procurement[]): readonly RiskSignal[] {
        const contexts = new Map<ARiskIndicatorDecision, EvaluationContext>(
            this.indicators.map((indicator) => [indicator, new EvaluationContext(run, indicator.parametersAsOf(run.dataAsOf))]),
        );
        const observationsByIndicator = new Map<ARiskIndicatorDecision, unknown[]>(
            this.indicators.map((indicator) => [indicator, []]),
        );

        for (const procurement of procurements) {
            this.evaluateProcurement(procurement, contexts, observationsByIndicator);
            for (const lot of procurement.lots) {
                this.evaluateLot(lot, procurement, contexts, observationsByIndicator);
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
        contexts: ReadonlyMap<ARiskIndicatorDecision, EvaluationContext>,
        observationsByIndicator: Map<ARiskIndicatorDecision, unknown[]>,
    ): void {
        const subject = this.subjectForProcurement(procurement);
        for (const indicator of this.indicators) {
            if (indicator.subjectType !== "procurement") continue;
            this.decide(indicator, subject, contexts.get(indicator)!, observationsByIndicator);
        }
    }

    /** Every lot-subjectType indicator's signal for this one lot. */
    private evaluateLot(
        lot: Lot,
        procurement: Procurement,
        contexts: ReadonlyMap<ARiskIndicatorDecision, EvaluationContext>,
        observationsByIndicator: Map<ARiskIndicatorDecision, unknown[]>,
    ): void {
        const subject = this.subjectForLot(lot, procurement);
        for (const indicator of this.indicators) {
            if (indicator.subjectType !== "lot") continue;
            this.decide(indicator, subject, contexts.get(indicator)!, observationsByIndicator);
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
        context: EvaluationContext,
        observationsByIndicator: Map<ARiskIndicatorDecision, unknown[]>,
    ): void {
        try {
            const outcome = indicator.isEligible(subject, context);
            const signal = outcome.eligible ? indicator.assessRisk(subject, context) : outcome.signal;
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
