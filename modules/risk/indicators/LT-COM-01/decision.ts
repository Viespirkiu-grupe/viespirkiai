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

        // validBids === 0: every bid the lot received was rejected, so no
        // supplier was left to award to. That is a failed procedure, not a
        // non-competitive award — the catalogue concept (OCP-R018, "a
        // single supplier faced no competition for this contract") has no
        // subject here, so it is not_applicable rather than a trigger.
        // LT-OTH-05 ("procedure unsuccessful or award not contracted") and
        // LT-AWD-04 ("excessive share of disqualified bids") are the
        // concepts that do cover it. Without this gate the naive
        // `validBids <= 1` reading made these 17.0% of the indicator's
        // whole triggered population (1,320 of 7,770 lots, run 676) and
        // contradicted the indicator's own published description ("liko tik
        // vienas tinkamas pasiūlymas"). Gated here rather than in
        // isEligible for the same reason the totalBids === 0 branch above
        // is: both are read off participation, which only assessRisk has
        // proved non-null.
        if (participation.validBids === 0) {
            return this.signalFor(subject, {
                state: "not_applicable",
                rawValue: { totalBids: participation.totalBids, validBids: 0 },
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
