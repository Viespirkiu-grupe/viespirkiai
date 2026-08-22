import type { LotSubject, RiskSignal } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltCom01Definition } from "./definition.ts";

// LT-COM-01 — Single valid bid: judges a lot from the participation counts
// the Procurement Reader already merged onto Subject.lot.participation. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

export class LtCom01Decision extends ALotIndicatorDecision<typeof ltCom01Definition> {
    static readonly definition = ltCom01Definition;
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor(context: EvaluationContext) {
        super(ltCom01Definition, context);
    }

    protected hasRequiredData(subject: LotSubject): boolean {
        return subject.lot.participation !== null;
    }

    assessRisk(subject: LotSubject): RiskSignal {
        const { lot } = subject;
        // hasRequiredData already proved this is non-null.
        const participation = lot.participation!;

        // totalBids === 0: a real, rarer case distinct from "no participation
        // observed" (hasRequiredData's null check) — a participant row
        // exists but every tiekejoKodas in it is NULL. Treated as an
        // incomplete report, not zero participation.
        if (participation.totalBids === 0) {
            return this.signalFor(subject, {
                state: "insufficient_data",
                missingData: ["tiekejoKodas"],
            });
        }

        const maximumValidBids = this.definition.parameters.maximumValidBids;
        return this.signalFor(subject, {
            state: participation.validBids <= maximumValidBids ? "triggered" : "not_triggered",
            rawValue: { totalBids: participation.totalBids, validBids: participation.validBids },
            threshold: { maximumValidBids },
            appliedParameters: { maximumValidBids },
        });
    }
}
