import type { LotSubject, RiskSignal } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltAwd01Definition } from "./definition.ts";

// LT-AWD-01 — All bids except winner disqualified: judges a lot from the
// same participation counts LT-COM-01 already reads (Subject.lot.participation).
// See docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

export class LtAwd01Decision extends ALotIndicatorDecision<typeof ltAwd01Definition> {
    static readonly definition = ltAwd01Definition;
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor(context: EvaluationContext) {
        super(ltAwd01Definition, context);
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
        // incomplete report, not zero participation. Same handling as
        // LT-COM-01.
        if (participation.totalBids === 0) {
            return this.signalFor(subject, {
                state: "insufficient_data",
                missingData: ["tiekejoKodas"],
            });
        }

        const { minimumTotalBids, survivingValidBids } = this.definition.parameters;
        const triggered =
            participation.totalBids >= minimumTotalBids && participation.validBids === survivingValidBids;
        return this.signalFor(subject, {
            state: triggered ? "triggered" : "not_triggered",
            rawValue: { totalBids: participation.totalBids, validBids: participation.validBids },
            threshold: { minimumTotalBids, survivingValidBids },
            appliedParameters: { minimumTotalBids, survivingValidBids },
        });
    }
}
