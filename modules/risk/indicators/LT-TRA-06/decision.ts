import type { ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltTra06Definition } from "./definition.ts";

// LT-TRA-06 — Procurement decision or reason not documented: judges a whole
// procurement from the same procedure-ending lots the Procurement Reader
// already merged onto Subject.procurement.procedureOutcome (shared with
// LT-OTH-03/LT-OTH-05 — see modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql).
// Unlike LT-OTH-05's "did ANY lot conclude" formula, this one triggers if ANY
// lot's decision lacks a stated reason: an undocumented decision on even one
// lot is itself the transparency failure this indicator looks for, not
// something another lot's well-documented decision can offset.

export class LtTra06Decision extends AProcurementIndicatorDecision<typeof ltTra06Definition> {
    static readonly definition = ltTra06Definition;
    protected readonly missingDataWhenAbsent = ["proceduruPabaiga"];

    constructor(context: EvaluationContext) {
        super(ltTra06Definition, context);
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        return subject.procurement.procedureOutcome !== null;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        const { procurement } = subject;
        // hasRequiredData already proved this is non-null.
        const { lots } = procurement.procedureOutcome!;

        const undocumented = lots.filter(
            (lot) => lot.sprendimoPriezastys === null || lot.sprendimoPriezastys.trim() === "",
        );
        return this.signalFor(subject, {
            state: undocumented.length > 0 ? "triggered" : "not_triggered",
            rawValue: { undocumentedLots: undocumented.map((lot) => lot.daliesNumeris) },
            threshold: { requireReasonForEveryLot: true },
            appliedParameters: {},
        });
    }
}
