import type { ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltTra08Definition } from "./definition.ts";

// LT-TRA-08 — Procurement challenged in court: judges a whole procurement
// from the ATN-1 (PPA) report's own "ieskinysTeismui" field, merged onto
// Subject.procurement.procedureOutcome.ieskinysTeismui by the Procurement
// Reader (shared with LT-TRA-06/LT-TRA-07/LT-PRI-06 — see
// modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql). No threshold beyond
// the field itself: the catalogue concept is "a court challenge exists", not
// "how many" or "how severe" — same convention as LT-TRA-07's sibling field.

export class LtTra08Decision extends AProcurementIndicatorDecision<typeof ltTra08Definition> {
    static readonly definition = ltTra08Definition;
    protected readonly missingDataWhenAbsent = ["ieskinysTeismui"];

    constructor(context: EvaluationContext) {
        super(ltTra08Definition, context);
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        return (subject.procurement.procedureOutcome?.ieskinysTeismui ?? null) !== null;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        // hasRequiredData already proved this is non-null.
        const ieskinysTeismui = subject.procurement.procedureOutcome!.ieskinysTeismui!;

        return this.signalFor(subject, {
            state: ieskinysTeismui ? "triggered" : "not_triggered",
            rawValue: { ieskinysTeismui },
            threshold: { ieskinysTeismui: true },
            appliedParameters: {},
        });
    }
}
