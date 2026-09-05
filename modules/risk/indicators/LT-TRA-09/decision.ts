import type { ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltTra09Definition } from "./definition.ts";

// LT-TRA-09 — Procurement not conducted electronically: judges a whole
// procurement from the ATN-1 (PPA) report's own "elektroninisPirkimas"
// field, merged onto Subject.procurement.procedureOutcome.elektroninisPirkimas
// by the Procurement Reader (shared with LT-TRA-06/LT-TRA-07/LT-TRA-08/
// LT-PRI-06 — see modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql). No
// threshold beyond the field itself: the catalogue concept is "the
// procedure was not conducted electronically", not "how many" or "how
// severe" — same convention as LT-TRA-08's sibling field. Note the
// direction is inverted relative to the raw field: the indicator triggers
// when elektroninisPirkimas is FALSE, not TRUE.

export class LtTra09Decision extends AProcurementIndicatorDecision<typeof ltTra09Definition> {
    static readonly definition = ltTra09Definition;
    protected readonly missingDataWhenAbsent = ["elektroninisPirkimas"];

    constructor(context: EvaluationContext) {
        super(ltTra09Definition, context);
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        return (subject.procurement.procedureOutcome?.elektroninisPirkimas ?? null) !== null;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        // hasRequiredData already proved this is non-null.
        const elektroninisPirkimas = subject.procurement.procedureOutcome!.elektroninisPirkimas!;

        return this.signalFor(subject, {
            state: elektroninisPirkimas ? "not_triggered" : "triggered",
            rawValue: { elektroninisPirkimas },
            threshold: { elektroninisPirkimas: false },
            appliedParameters: {},
        });
    }
}
