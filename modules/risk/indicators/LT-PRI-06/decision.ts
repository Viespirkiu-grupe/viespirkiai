import type { ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltPri06Definition } from "./definition.ts";

// LT-PRI-06 — High estimated framework value: judges a whole procurement
// from whether its ATN-1/PPA report says it establishes a framework
// agreement (Subject.procurement.procedureOutcome.preliminariSutartis) and, if so,
// its own numatomaVerteEUR. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4 and
// modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql.
//
// hasRequiredData() is not "is one field null" — a report that positively
// says preliminariSutartis: false already answers the formula (not_triggered,
// regardless of value) without needing numatomaVerteEUR at all. Only when
// preliminariSutartis is true, or unknown, does the value's presence matter.

export class LtPri06Decision extends AProcurementIndicatorDecision<typeof ltPri06Definition> {
    static readonly definition = ltPri06Definition;
    protected readonly missingDataWhenAbsent = ["preliminariSutartis", "numatomaVerteEUR"];

    constructor(context: EvaluationContext) {
        super(ltPri06Definition, context);
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        const preliminariSutartis = subject.procurement.procedureOutcome?.preliminariSutartis ?? null;
        if (preliminariSutartis === null) {
            return false;
        }
        if (preliminariSutartis === false) {
            return true;
        }
        return subject.procurement.numatomaVerteEUR !== null;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        // hasRequiredData already proved preliminariSutartis is non-null.
        const preliminariSutartis = subject.procurement.procedureOutcome!.preliminariSutartis!;
        const { minimumValueEUR } = this.definition.parameters;

        if (!preliminariSutartis) {
            return this.signalFor(subject, {
                state: "not_triggered",
                rawValue: { preliminariSutartis },
                threshold: { minimumValueEUR },
                appliedParameters: { minimumValueEUR },
            });
        }

        // hasRequiredData already proved this is non-null when preliminariSutartis is true.
        const numatomaVerteEUR = subject.procurement.numatomaVerteEUR!;
        return this.signalFor(subject, {
            state: numatomaVerteEUR > minimumValueEUR ? "triggered" : "not_triggered",
            rawValue: { preliminariSutartis, numatomaVerteEUR },
            threshold: { minimumValueEUR },
            appliedParameters: { minimumValueEUR },
        });
    }
}
