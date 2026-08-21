import { ARiskIndicatorDecision } from "./riskIndicatorDecision.ts";
import { lotEligibility, procurementEligibility } from "./procurementEligibility.ts";
import type { Decision, EligibilityOutcome, RiskIndicatorDefinition, Subject } from "./types.ts";
import type { EvaluationContext } from "./evaluationContext.ts";

// The two subject-type specializations of ARiskIndicatorDecision
// (riskIndicatorDecision.ts): one per Decision Area from
// docs/indicators-story/risk-service-architecture-v2.md §3.2 ("Procurement
// Risk Decision Service" / "Procurement Lot Risk Decision Service"). Each
// implements isEligible with its own Eligibility Decision (§3.3) — the
// shared Procurement/Lot Eligibility Decision, then the bulk-facts
// insufficient_data check — so a subject-type-agnostic base class never has
// to branch on subjectType itself.

/** For indicators whose subjectType is 'procurement'. */
export abstract class AProcurementIndicatorDecision<F, D extends RiskIndicatorDefinition> extends ARiskIndicatorDecision<
    F,
    D
> {
    isEligible(subject: Subject, context: EvaluationContext): EligibilityOutcome {
        if (subject.subjectType !== "procurement") {
            throw new Error(`${this.id}: expected a procurement subject, got ${subject.subjectType}`);
        }

        const gate = procurementEligibility(subject.procurement);
        if (!gate.eligible) {
            return { eligible: false, signal: this.signalFor(subject, context, gate.decision, null) };
        }

        if (this.factsFor(subject) === undefined) {
            const decision: Decision = {
                state: "insufficient_data",
                missingData: [...this.missingDataWhenAbsent],
            };
            return { eligible: false, signal: this.signalFor(subject, context, decision, null) };
        }

        return { eligible: true };
    }
}

/** For indicators whose subjectType is 'lot'. */
export abstract class ALotIndicatorDecision<F, D extends RiskIndicatorDefinition> extends ARiskIndicatorDecision<F, D> {
    isEligible(subject: Subject, context: EvaluationContext): EligibilityOutcome {
        if (subject.subjectType !== "lot") {
            throw new Error(`${this.id}: expected a lot subject, got ${subject.subjectType}`);
        }

        const gate = lotEligibility(subject.lot, subject.procurement);
        if (!gate.eligible) {
            return { eligible: false, signal: this.signalFor(subject, context, gate.decision, null) };
        }

        if (this.factsFor(subject) === undefined) {
            const decision: Decision = {
                state: "insufficient_data",
                missingData: [...this.missingDataWhenAbsent],
            };
            return { eligible: false, signal: this.signalFor(subject, context, decision, null) };
        }

        return { eligible: true };
    }
}
