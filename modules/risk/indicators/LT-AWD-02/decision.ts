import type { Bid, LotSubject, RiskSignal } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltAwd02Definition } from "./definition.ts";

// LT-AWD-02 — Lowest bid disqualified: the first lot-grain indicator to
// read Subject.lot.bids (per-bid price/rejection) rather than the
// aggregate lot.participation counts LT-AWD-01/LT-COM-01/LT-COM-02 use. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

// A bid price of 0 or less is a data-quality artefact (e.g. an unparsed
// "NaN"/negative value from the source XLSX), not a genuine offer — see
// this indicator's README for the handful of nationwide rows this excludes.
function isUsablePrice(bid: Bid): bid is Bid & { pasiulymoKaina: number } {
    return bid.pasiulymoKaina !== null && bid.pasiulymoKaina > 0;
}

export class LtAwd02Decision extends ALotIndicatorDecision<typeof ltAwd02Definition> {
    static readonly definition = ltAwd02Definition;
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor(context: EvaluationContext) {
        super(ltAwd02Definition, context);
    }

    protected hasRequiredData(subject: LotSubject): boolean {
        return subject.lot.participation !== null;
    }

    assessRisk(subject: LotSubject): RiskSignal {
        const { lot } = subject;
        const { minimumPricedBids } = this.definition.parameters;

        // No per-bid rows at all — the same "report lists no usable
        // participants" gap LT-AWD-01 handles for its own aggregate shape.
        if (lot.bids.length === 0) {
            return this.signalFor(subject, {
                state: "insufficient_data",
                missingData: ["tiekejoKodas"],
            });
        }

        const pricedBids = lot.bids.filter(isUsablePrice);
        if (pricedBids.length === 0) {
            return this.signalFor(subject, {
                state: "insufficient_data",
                missingData: ["pasiulymoKaina"],
            });
        }

        if (pricedBids.length < minimumPricedBids) {
            return this.signalFor(subject, {
                state: "not_triggered",
                rawValue: { pricedBids: pricedBids.length },
                threshold: { minimumPricedBids },
                appliedParameters: { minimumPricedBids },
            });
        }

        const lowestPrice = Math.min(...pricedBids.map((bid) => bid.pasiulymoKaina));
        const lowestBids = pricedBids.filter((bid) => bid.pasiulymoKaina === lowestPrice);
        const lowestBidDisqualified = lowestBids.every((bid) => bid.atmetimoPriezastis !== null);
        const higherValidBidExists = pricedBids.some(
            (bid) => bid.atmetimoPriezastis === null && bid.pasiulymoKaina > lowestPrice,
        );

        const triggered = lowestBidDisqualified && higherValidBidExists;
        return this.signalFor(subject, {
            state: triggered ? "triggered" : "not_triggered",
            rawValue: { pricedBids: pricedBids.length, lowestPrice, lowestBidDisqualified, higherValidBidExists },
            threshold: { minimumPricedBids },
            appliedParameters: { minimumPricedBids },
        });
    }
}
