import type { LotSubject, RiskSignal } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltAwd04Definition } from "./definition.ts";

// LT-AWD-04 — Excessive share of disqualified bids: judges a lot from the
// same participation counts LT-COM-01/LT-COM-02/LT-AWD-01 already read
// (Subject.lot.participation). See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

export class LtAwd04Decision extends ALotIndicatorDecision<typeof ltAwd04Definition> {
    static readonly definition = ltAwd04Definition;
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor(context: EvaluationContext) {
        super(ltAwd04Definition, context);
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
        // LT-COM-01/LT-COM-02/LT-AWD-01.
        if (participation.totalBids === 0) {
            return this.signalFor(subject, {
                state: "insufficient_data",
                missingData: ["tiekejoKodas"],
            });
        }

        const { minimumTotalBids, disqualifiedShareThreshold } = this.definition.parameters;
        const disqualifiedShare = (participation.totalBids - participation.validBids) / participation.totalBids;

        if (participation.totalBids < minimumTotalBids) {
            return this.signalFor(subject, {
                state: "not_triggered",
                rawValue: { totalBids: participation.totalBids, disqualifiedShare },
                threshold: { minimumTotalBids, disqualifiedShareThreshold },
                appliedParameters: { minimumTotalBids, disqualifiedShareThreshold },
            });
        }

        const triggered = disqualifiedShare >= disqualifiedShareThreshold;
        return this.signalFor(subject, {
            state: triggered ? "triggered" : "not_triggered",
            rawValue: { totalBids: participation.totalBids, disqualifiedShare },
            threshold: { minimumTotalBids, disqualifiedShareThreshold },
            appliedParameters: { minimumTotalBids, disqualifiedShareThreshold },
        });
    }
}
