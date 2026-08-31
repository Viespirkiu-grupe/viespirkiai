import type { BidSubject, RiskSignal } from "../../types.ts";
import { ABidIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltCom21Definition } from "./definition.ts";

// LT-COM-21 — Non-genuine, incomplete, or incapable bid: judges one
// supplier's individual bid, from the raw bid row the Procurement Reader
// already merged onto Subject.lot.bids (Bid, in types.ts). See
// docs/indicators-story/risk-service-architecture.md §1.2/§3.4 and
// docs/indicators-story/domain-model.md §1.1 ("v_dalyviai" subject entity).

export class LtCom21Decision extends ABidIndicatorDecision<typeof ltCom21Definition> {
    static readonly definition = ltCom21Definition;
    protected readonly missingDataWhenAbsent = ["eileNumeris", "atmetimoStatusas"];

    constructor(context: EvaluationContext) {
        super(ltCom21Definition, context);
    }

    // Mirrors LT-COM-20: only insufficient when the ATN-1 report's LATERAL
    // offer-detail join (v_dalyviai_v2.sql) found nothing at all for this
    // bidder — no ranking and no rejection outcome of any kind. A bid that
    // was ranked (eileNumeris present) is positively known not to have been
    // disqualified, even though atmetimoPriezastis is null for it — that is
    // not_triggered, not insufficient_data.
    protected hasRequiredData(subject: BidSubject): boolean {
        const { bid } = subject;
        return bid.eileNumeris !== null || bid.atmetimoStatusas !== null || bid.atmetimoPriezastis !== null;
    }

    assessRisk(subject: BidSubject): RiskSignal {
        const { bid } = subject;
        const { nonGenuineIncompleteIncapableLegalBases } = this.definition.parameters;

        const disqualified = bid.atmetimoPriezastis !== null;
        const nonGenuineOrIncapable =
            disqualified &&
            bid.atmetimoTeisinisPagrindas !== null &&
            nonGenuineIncompleteIncapableLegalBases.includes(bid.atmetimoTeisinisPagrindas);

        return this.signalFor(subject, {
            state: nonGenuineOrIncapable ? "triggered" : "not_triggered",
            rawValue: { atmetimoPriezastis: bid.atmetimoPriezastis, atmetimoTeisinisPagrindas: bid.atmetimoTeisinisPagrindas },
            threshold: { nonGenuineIncompleteIncapableLegalBases },
            appliedParameters: { nonGenuineIncompleteIncapableLegalBases },
        });
    }
}
