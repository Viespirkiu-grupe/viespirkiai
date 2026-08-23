import type { ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltOth05Definition } from "./definition.ts";

// LT-OTH-05 — Procedure unsuccessful or award not contracted: judges a whole
// procurement from the procedure-ending outcome labels the Procurement
// Reader already merged onto Subject.procurement.procedureOutcome. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4 and
// modules/mcp/analyst/views/v_pirkimo_pabaiga.sql.

export class LtOth05Decision extends AProcurementIndicatorDecision<typeof ltOth05Definition> {
    static readonly definition = ltOth05Definition;
    protected readonly missingDataWhenAbsent = ["proceduruPabaiga"];

    constructor(context: EvaluationContext) {
        super(ltOth05Definition, context);
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        return subject.procurement.procedureOutcome !== null;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        const { procurement } = subject;
        // hasRequiredData already proved this is non-null.
        const { lotOutcomes } = procurement.procedureOutcome!;
        const { concludedOutcomes } = this.definition.parameters;

        const anyLotConcluded = lotOutcomes.some((outcome) => concludedOutcomes.includes(outcome));
        return this.signalFor(subject, {
            state: anyLotConcluded ? "not_triggered" : "triggered",
            rawValue: { lotOutcomes },
            threshold: { concludedOutcomes },
            appliedParameters: { concludedOutcomes },
        });
    }
}
