import type { RiskSignal, Subject } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltCom02Definition } from "./definition.ts";

// LT-COM-02 — Low number of bidders: judges a lot from the participation
// counts the Procurement Reader already merged onto
// Subject.lot.participation. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

export class LtCom02Decision extends ALotIndicatorDecision<typeof ltCom02Definition> {
    static readonly definition = ltCom02Definition;
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor(context: EvaluationContext) {
        super(ltCom02Definition, context);
    }

    protected hasRequiredData(subject: Subject): boolean {
        return subject.subjectType === "lot" && subject.lot.participation !== null;
    }

    assessRisk(subject: Subject, context: EvaluationContext): RiskSignal {
        if (subject.subjectType !== "lot") {
            throw new Error("LT-COM-02: expected a lot subject");
        }
        const { lot, procurement } = subject;
        // hasRequiredData already proved this is non-null.
        const participation = lot.participation!;
        const evidence = {
            pirkimoBudas: procurement.pirkimoBudas,
            ataskaitosData: participation.reportedAt,
            source: "ATN-1 ataskaita",
        };

        // totalBids === 0: a real, rarer case distinct from "no participation
        // observed" (hasRequiredData's null check) — a participant row
        // exists but every tiekejoKodas in it is NULL. Treated as an
        // incomplete report, not zero participation.
        if (participation.totalBids === 0) {
            return this.signalFor(subject, context, {
                state: "insufficient_data",
                evidence,
                missingData: ["tiekejoKodas"],
            });
        }

        const minimumBidders = this.definition.parameters.minimumBidders;
        return this.signalFor(subject, context, {
            state: participation.totalBids < minimumBidders ? "triggered" : "not_triggered",
            rawValue: { totalBids: participation.totalBids },
            threshold: { minimumBidders },
            evidence,
            appliedParameters: { minimumBidders },
        });
    }
}
