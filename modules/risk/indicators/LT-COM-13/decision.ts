import type { Bid, LotSubject, RiskSignal } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltCom13Definition } from "./definition.ts";

// LT-COM-13 — Wide disparity in bid prices: reads Subject.lot.bids (per-bid
// price) the same way LT-COM-10/LT-COM-11/LT-COM-12 do. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

// A bid price of 0 or less is a data-quality artefact (e.g. an unparsed
// "NaN"/negative value from the source XLSX), not a genuine offer — same
// guard LT-COM-10/LT-COM-11/LT-COM-12 use, and for the same reason.
function isUsablePrice(bid: Bid): bid is Bid & { pasiulymoKaina: number } {
    return bid.pasiulymoKaina !== null && bid.pasiulymoKaina > 0;
}

export class LtCom13Decision extends ALotIndicatorDecision<typeof ltCom13Definition> {
    static readonly definition = ltCom13Definition;
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor(context: EvaluationContext) {
        super(ltCom13Definition, context);
    }

    protected hasRequiredData(subject: LotSubject): boolean {
        return subject.lot.participation !== null;
    }

    assessRisk(subject: LotSubject): RiskSignal {
        const { lot } = subject;
        const { minimumPricedBids, minRelativeGap } = this.definition.parameters;
        const threshold = { minimumPricedBids, minRelativeGap };

        // No per-bid rows at all — the same "report lists no usable
        // participants" gap LT-COM-10/LT-COM-11/LT-COM-12 handle.
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
                threshold,
                appliedParameters: threshold,
            });
        }

        // lot.bids is already one row per distinct tiekejoKodas (the
        // Procurement Reader's LOT_BIDS_SQL is DISTINCT ON tiekejoKodas), so
        // the two lowest prices here are necessarily two different
        // suppliers' offers, never the same supplier's bid counted twice.
        const prices = pricedBids.map((bid) => bid.pasiulymoKaina).sort((a, b) => a - b);
        const lowestPrice = prices[0];
        const secondLowestPrice = prices[1];
        const relativeGap = (secondLowestPrice - lowestPrice) / lowestPrice;
        const triggered = relativeGap >= minRelativeGap;

        return this.signalFor(subject, {
            state: triggered ? "triggered" : "not_triggered",
            rawValue: {
                pricedBids: pricedBids.length,
                lowestPrice,
                secondLowestPrice,
                relativeGap,
            },
            threshold,
            appliedParameters: threshold,
        });
    }
}
