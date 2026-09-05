import type { ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltPro05Definition } from "./definition.ts";

// LT-PRO-05 — Accelerated procedure without adequate grounds: judges a whole
// procurement from its own pirkimoBudas, already present on
// Subject.procurement (no reader change needed — see README.md). See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.
//
// hasRequiredData() is trivially true for every eligible subject:
// procurementEligibility() already requires pirkimoBudas to be non-null
// before isEligible() calls hasRequiredData() at all (see
// procurementLotDecision.ts). It is still implemented explicitly, matching
// every other indicator's contract, rather than special-cased away.

export class LtPro05Decision extends AProcurementIndicatorDecision<typeof ltPro05Definition> {
    static readonly definition = ltPro05Definition;
    protected readonly missingDataWhenAbsent = ["pirkimoBudas"];

    constructor(context: EvaluationContext) {
        super(ltPro05Definition, context);
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        return subject.procurement.pirkimoBudas !== null;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        // hasRequiredData already proved this is non-null.
        const pirkimoBudas = subject.procurement.pirkimoBudas!;
        const { acceleratedProcedures } = this.definition.parameters;

        return this.signalFor(subject, {
            state: acceleratedProcedures.includes(pirkimoBudas) ? "triggered" : "not_triggered",
            rawValue: { pirkimoBudas },
            threshold: { acceleratedProcedures },
            appliedParameters: { acceleratedProcedures },
        });
    }
}
