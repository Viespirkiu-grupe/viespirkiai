import type { ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltPri06Definition } from "./definition.ts";

// LT-PRI-06 — High estimated framework value: judges a whole procurement
// from whether its ATN-1/PPA report says it establishes a framework
// agreement (Subject.procurement.procedureOutcome.isFramework) and, if so,
// its own numatomaVerteEUR. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4 and
// modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql.
//
// hasRequiredData() is not "is one field null" — a report that positively
// says isFramework: false already answers the formula (not_triggered,
// regardless of value) without needing numatomaVerteEUR at all. Only when
// isFramework is true, or unknown, does the value's presence matter.

export class LtPri06Decision extends AProcurementIndicatorDecision<typeof ltPri06Definition> {
    static readonly definition = ltPri06Definition;
    protected readonly missingDataWhenAbsent = ["preliminariSutartis", "numatomaVerteEUR"];

    constructor(context: EvaluationContext) {
        super(ltPri06Definition, context);
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        const isFramework = subject.procurement.procedureOutcome?.isFramework ?? null;
        if (isFramework === null) {
            return false;
        }
        if (isFramework === false) {
            return true;
        }
        return subject.procurement.numatomaVerteEUR !== null;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        // hasRequiredData already proved isFramework is non-null.
        const isFramework = subject.procurement.procedureOutcome!.isFramework!;
        const { minimumValueEUR } = this.definition.parameters;

        if (!isFramework) {
            return this.signalFor(subject, {
                state: "not_triggered",
                rawValue: { isFramework },
                threshold: { minimumValueEUR },
                appliedParameters: { minimumValueEUR },
            });
        }

        // hasRequiredData already proved this is non-null when isFramework is true.
        const numatomaVerteEUR = subject.procurement.numatomaVerteEUR!;
        return this.signalFor(subject, {
            state: numatomaVerteEUR > minimumValueEUR ? "triggered" : "not_triggered",
            rawValue: { isFramework, numatomaVerteEUR },
            threshold: { minimumValueEUR },
            appliedParameters: { minimumValueEUR },
        });
    }
}
