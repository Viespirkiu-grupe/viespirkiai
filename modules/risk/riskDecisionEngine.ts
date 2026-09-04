import { log } from "../../utils/log.js";
import type { EvaluationContext } from "./evaluationContext.ts";
import type { ARiskIndicatorDecision } from "./riskIndicatorDecision.ts";
import type { Bid, Lot, Procurement, ProcurementRiskDecisions, RiskSignal, Subject } from "./types.ts";

/**
 * The Risk Decision Engine (docs/indicators-story/risk-service-
 * architecture.md §1.2): the only place that loops indicators over the
 * subject universe. A Risk Indicator's own responsibility ends at
 * isEligible(subject)/assessRisk(subject) — one subject at a time
 * (riskIndicatorDecision.ts); batching over every procurement, its lots and
 * its bids, and collecting each procurement's signals into its
 * ProcurementRiskDecisions, belongs here. Pure — no I/O — it only ever
 * touches the already-loaded Procurements the Procurement Reader
 * (procurementReader.ts) handed it.
 */
export class RiskDecisionEngine {
    private readonly procurementIndicators: readonly ARiskIndicatorDecision[];
    private readonly lotIndicators: readonly ARiskIndicatorDecision[];
    private readonly bidIndicators: readonly ARiskIndicatorDecision[];

    private readonly context: EvaluationContext;

    /**
     * `indicators` are already evaluation-scoped — each carries its own
     * fixed EvaluationContext (riskIndicatorDecision.ts), built by
     * RiskIndicatorRegistry.createAllIndicators(context)
     * (registry.ts). `context` is that same run-scoped context, passed
     * explicitly rather than read off an indicator, so dataAsOf is
     * available even when a subject-type's indicator list is empty — it's
     * used only to stamp the ProcurementRiskDecisions this class collects,
     * never to build or resolve indicators. Split by subjectType once here,
     * so evaluateProcurementSignals/evaluateLot/evaluateBid each walk only
     * the indicators that apply to their subject.
     */
    constructor(indicators: readonly ARiskIndicatorDecision[], context: EvaluationContext) {
        this.procurementIndicators = indicators.filter((indicator) => indicator.subjectType === "procurement");
        this.lotIndicators = indicators.filter((indicator) => indicator.subjectType === "lot");
        this.bidIndicators = indicators.filter((indicator) => indicator.subjectType === "bid");
        this.context = context;
    }

    /**
     * Walks every procurement, collecting its own signal, its lots'
     * (evaluateLot) and each lot's individual bids' (evaluateBid) into that
     * procurement's single ProcurementRiskDecisions (risk-service-
     * architecture.md §1.1's Decision Collector, §2.3's output model) — one
     * per input procurement. Each signal is already validated and frozen by
     * ARiskIndicatorDecision.signalFor (riskIndicatorDecision.ts) at the
     * moment it's built, so there's nothing left for the Engine to do but
     * collect them.
     */
    evaluateAll(procurements: readonly Procurement[]): readonly ProcurementRiskDecisions[] {
        return procurements.map((procurement) => this.evaluateProcurement(procurement));
    }

    /** Collects every signal for one procurement — its own, its lots' and its bids' — into its ProcurementRiskDecisions. */
    private evaluateProcurement(procurement: Procurement): ProcurementRiskDecisions {
        const signals: RiskSignal[] = [...this.evaluateProcurementSignals(procurement)];

        for (const lot of procurement.lots) {
            signals.push(...this.evaluateLot(lot, procurement));
            if (this.bidIndicators.length > 0) {
                for (const bid of lot.bids) {
                    signals.push(...this.evaluateBid(bid, lot, procurement));
                }
            }
        }

        const now = new Date();
        return {
            procurementSource: procurement.saltinis ?? "unknown",
            procurementId: procurement.pirkimoNumeris,
            signals,
            dataAsOf: this.context.dataAsOf,
            createdAt: now,
            updatedAt: now,
        };
    }

    /** Every procurement-subjectType indicator's signal for this one procurement. */
    private evaluateProcurementSignals(procurement: Procurement): RiskSignal[] {
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

    /** Every bid-subjectType indicator's signal for this one bid. */
    private evaluateBid(bid: Bid, lot: Lot, procurement: Procurement): RiskSignal[] {
        const subject = this.subjectForBid(bid, lot, procurement);
        const signals: RiskSignal[] = [];
        for (const indicator of this.bidIndicators) {
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
            const outcome = indicator.isEligible(subject);
            return outcome.eligible ? indicator.assessRisk(subject) : outcome.signal;
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

    private subjectForBid(bid: Bid, lot: Lot, procurement: Procurement): Subject {
        return {
            subjectType: "bid",
            subjectKey: `${lot.subjektoRaktas}:${bid.tiekejoKodas}`,
            procurementSource: lot.saltinis,
            procurementId: lot.pirkimoNumeris,
            bid,
            lot,
            procurement,
        };
    }
}
