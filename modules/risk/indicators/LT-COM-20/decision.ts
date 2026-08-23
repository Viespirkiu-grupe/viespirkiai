import type { BidSubject, RiskSignal } from "../../types.ts";
import { ABidIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltCom20Definition } from "./definition.ts";

// LT-COM-20 — Unexpected or frequent bid withdrawal: judges one supplier's
// individual bid, from the raw bid row the Procurement Reader already
// merged onto Subject.lot.bids (Bid, in types.ts). See
// docs/indicators-story/risk-service-architecture.md §1.2/§3.4 and
// docs/indicators-story/domain-model.md §1.1 ("v_dalyviai" subject entity).

export class LtCom20Decision extends ABidIndicatorDecision<typeof ltCom20Definition> {
    static readonly definition = ltCom20Definition;
    protected readonly missingDataWhenAbsent = ["eileNumeris", "atmetimoStatusas"];

    constructor(context: EvaluationContext) {
        super(ltCom20Definition, context);
    }

    // Only insufficient when the ATN-1 report's LATERAL offer-detail join
    // (v_dalyviai_v2.sql) found nothing at all for this bidder: no ranking
    // and no rejection outcome. A bid that made it into the price ranking
    // (eileNumeris present) is positively known not to have been withdrawn,
    // even though atmetimoStatusas is null for it — that is not_triggered,
    // not insufficient_data.
    protected hasRequiredData(subject: BidSubject): boolean {
        const { bid } = subject;
        return bid.eileNumeris !== null || bid.atmetimoStatusas !== null || bid.atmetimoPriezastis !== null;
    }

    assessRisk(subject: BidSubject): RiskSignal {
        const { bid } = subject;
        const { withdrawalStatuses } = this.definition.parameters;

        const withdrawn = bid.atmetimoStatusas !== null && withdrawalStatuses.includes(bid.atmetimoStatusas);
        return this.signalFor(subject, {
            state: withdrawn ? "triggered" : "not_triggered",
            rawValue: { atmetimoStatusas: bid.atmetimoStatusas },
            threshold: { withdrawalStatuses },
            appliedParameters: { withdrawalStatuses },
        });
    }
}
