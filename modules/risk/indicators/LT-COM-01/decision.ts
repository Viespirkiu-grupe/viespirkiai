import type { LotSubject, RiskSignal, Subject } from "../../types.ts";
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

    protected hasRequiredData(subject: Subject): boolean {
        return subject.subjectType === "lot" && subject.lot.participation !== null;
    }

    // RiskDecisionEngine only ever calls a lot-subjectType indicator
    // (lotIndicators) with a LotSubject (evaluateLot, riskDecisionEngine.ts)
    // — subjects are already routed by subjectType before this runs.
    assessRisk(subject: Subject, context: EvaluationContext): RiskSignal {
        const { lot } = subject as LotSubject;
        // hasRequiredData already proved this is non-null.
        const participation = lot.participation!;

        // totalBids === 0: a real, rarer case distinct from "no participation
        // observed" (hasRequiredData's null check) — a participant row
        // exists but every tiekejoKodas in it is NULL. Treated as an
        // incomplete report, not zero participation.
        if (participation.totalBids === 0) {
            return this.signalFor(subject, context, {
                state: "insufficient_data",
                missingData: ["tiekejoKodas"],
            });
        }

        const maximumValidBids = this.definition.parameters.maximumValidBids;
        return this.signalFor(subject, context, {
            state: participation.validBids <= maximumValidBids ? "triggered" : "not_triggered",
            rawValue: { totalBids: participation.totalBids, validBids: participation.validBids },
            threshold: { maximumValidBids },
            appliedParameters: { maximumValidBids },
        });
    }
}
