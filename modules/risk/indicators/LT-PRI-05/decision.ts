import type { ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltPri05Definition } from "./definition.ts";

// LT-PRI-05 — High estimated value: judges a whole procurement from its own
// numatomaVerteEUR, already present on Subject.procurement (no reader
// change needed — see README.md). See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

export class LtPri05Decision extends AProcurementIndicatorDecision<typeof ltPri05Definition> {
    static readonly definition = ltPri05Definition;
    protected readonly missingDataWhenAbsent = ["numatomaVerteEUR"];

    constructor(context: EvaluationContext) {
        super(ltPri05Definition, context);
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        return subject.procurement.numatomaVerteEUR !== null;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        // hasRequiredData already proved this is non-null.
        const numatomaVerteEUR = subject.procurement.numatomaVerteEUR!;
        const { minimumValueEUR } = this.definition.parameters;

        return this.signalFor(subject, {
            state: numatomaVerteEUR > minimumValueEUR ? "triggered" : "not_triggered",
            rawValue: { numatomaVerteEUR },
            threshold: { minimumValueEUR },
            appliedParameters: { minimumValueEUR },
        });
    }
}
