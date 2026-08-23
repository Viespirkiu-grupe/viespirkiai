import { ARiskIndicatorDecision } from "./riskIndicatorDecision.ts";
import { lotEligibility, procurementEligibility } from "./procurementEligibility.ts";
import type { BidSubject, EligibilityOutcome, LotSubject, PartialRiskSignal, ProcurementSubject, RiskIndicatorDefinition } from "./types.ts";

// The subject-type specializations of ARiskIndicatorDecision
// (riskIndicatorDecision.ts): one per Decision Area from
// docs/indicators-story/risk-service-architecture-v2.md §3.2 ("Procurement
// Risk Decision Service" / "Procurement Lot Risk Decision Service", plus the
// bid-grain indicators the catalogue's "Bid / bidder participation" subject
// register requires). Each implements isEligible with its own Eligibility
// Decision (§3.3) — the shared Procurement/Lot Eligibility Decision, then
// hasRequiredData() — so a subject-type-agnostic base class never has to
// branch on subjectType itself.

/** For indicators whose subjectType is 'procurement'. */
export abstract class AProcurementIndicatorDecision<
    D extends RiskIndicatorDefinition,
> extends ARiskIndicatorDecision<D, ProcurementSubject> {
    isEligible(subject: ProcurementSubject): EligibilityOutcome {
        if (subject.subjectType !== "procurement") {
            throw new Error(`${this.id}: expected a procurement subject, got ${subject.subjectType}`);
        }

        const gate = procurementEligibility(subject.procurement);
        if (!gate.eligible) {
            return { eligible: false, signal: this.signalFor(subject, gate.decision) };
        }

        if (!this.hasRequiredData(subject)) {
            const partial: PartialRiskSignal = {
                state: "insufficient_data",
                missingData: [...this.missingDataWhenAbsent],
            };
            return { eligible: false, signal: this.signalFor(subject, partial) };
        }

        return { eligible: true };
    }
}

/** For indicators whose subjectType is 'lot'. */
export abstract class ALotIndicatorDecision<
    D extends RiskIndicatorDefinition,
> extends ARiskIndicatorDecision<D, LotSubject> {
    isEligible(subject: LotSubject): EligibilityOutcome {
        if (subject.subjectType !== "lot") {
            throw new Error(`${this.id}: expected a lot subject, got ${subject.subjectType}`);
        }

        const gate = lotEligibility(subject.lot, subject.procurement);
        if (!gate.eligible) {
            return { eligible: false, signal: this.signalFor(subject, gate.decision) };
        }

        if (!this.hasRequiredData(subject)) {
            const partial: PartialRiskSignal = {
                state: "insufficient_data",
                missingData: [...this.missingDataWhenAbsent],
            };
            return { eligible: false, signal: this.signalFor(subject, partial) };
        }

        return { eligible: true };
    }
}

/**
 * For indicators whose subjectType is 'bid'. No bid-specific eligibility
 * rule exists yet — delegates to its parent lot's gate, same as
 * ALotIndicatorDecision delegates to its parent procurement's.
 */
export abstract class ABidIndicatorDecision<
    D extends RiskIndicatorDefinition,
> extends ARiskIndicatorDecision<D, BidSubject> {
    isEligible(subject: BidSubject): EligibilityOutcome {
        if (subject.subjectType !== "bid") {
            throw new Error(`${this.id}: expected a bid subject, got ${subject.subjectType}`);
        }

        const gate = lotEligibility(subject.lot, subject.procurement);
        if (!gate.eligible) {
            return { eligible: false, signal: this.signalFor(subject, gate.decision) };
        }

        if (!this.hasRequiredData(subject)) {
            const partial: PartialRiskSignal = {
                state: "insufficient_data",
                missingData: [...this.missingDataWhenAbsent],
            };
            return { eligible: false, signal: this.signalFor(subject, partial) };
        }

        return { eligible: true };
    }
}
