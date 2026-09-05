import type { ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltTra07Definition } from "./definition.ts";

// LT-TRA-07 — Complaint received: judges a whole procurement from the ATN-1
// (PPA) report's own "pretenzijaPateikta" field, merged onto
// Subject.procurement.procedureOutcome.pretenzijaPateikta by the Procurement
// Reader (shared with LT-TRA-06/LT-PRI-06 — see
// modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql). No threshold beyond
// the field itself: the catalogue concept is "a complaint exists", not "how
// many" or "how severe".

export class LtTra07Decision extends AProcurementIndicatorDecision<typeof ltTra07Definition> {
    static readonly definition = ltTra07Definition;
    protected readonly missingDataWhenAbsent = ["pretenzijaPateikta"];

    constructor(context: EvaluationContext) {
        super(ltTra07Definition, context);
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        return (subject.procurement.procedureOutcome?.pretenzijaPateikta ?? null) !== null;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        // hasRequiredData already proved this is non-null.
        const pretenzijaPateikta = subject.procurement.procedureOutcome!.pretenzijaPateikta!;

        return this.signalFor(subject, {
            state: pretenzijaPateikta ? "triggered" : "not_triggered",
            rawValue: { pretenzijaPateikta },
            threshold: { pretenzijaPateikta: true },
            appliedParameters: {},
        });
    }
}
