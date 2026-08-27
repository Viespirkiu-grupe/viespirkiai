import type { Bid, LotSubject, RiskSignal } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltCom12Definition } from "./definition.ts";

// LT-COM-12 — Suspiciously close bid prices: reads Subject.lot.bids (per-bid
// price) the same way LT-COM-10/LT-COM-11 do. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

// A bid price of 0 or less is a data-quality artefact (e.g. an unparsed
// "NaN"/negative value from the source XLSX), not a genuine offer — same
// guard LT-COM-10/LT-COM-11 use, and for the same reason.
function isUsablePrice(bid: Bid): bid is Bid & { pasiulymoKaina: number } {
    return bid.pasiulymoKaina !== null && bid.pasiulymoKaina > 0;
}

type CloseMatch = Readonly<{
    relativeDifference: number;
    lowerPrice: number;
    higherPrice: number;
}>;

// The tightest close-but-not-identical match among every pair of
// distinct-supplier priced bids, or null if none of them land within
// maxRelativeDifference. A relative difference of exactly 0 (identical
// prices) never matches here — that is LT-COM-10's own, stronger concept.
function findClosestMatch(prices: readonly number[], maxRelativeDifference: number): CloseMatch | null {
    let best: CloseMatch | null = null;
    for (let i = 0; i < prices.length; i++) {
        for (let j = i + 1; j < prices.length; j++) {
            const lowerPrice = Math.min(prices[i], prices[j]);
            const higherPrice = Math.max(prices[i], prices[j]);
            const relativeDifference = (higherPrice - lowerPrice) / lowerPrice;
            if (relativeDifference <= 0 || relativeDifference > maxRelativeDifference) {
                continue;
            }
            if (best === null || relativeDifference < best.relativeDifference) {
                best = { relativeDifference, lowerPrice, higherPrice };
            }
        }
    }
    return best;
}

export class LtCom12Decision extends ALotIndicatorDecision<typeof ltCom12Definition> {
    static readonly definition = ltCom12Definition;
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor(context: EvaluationContext) {
        super(ltCom12Definition, context);
    }

    protected hasRequiredData(subject: LotSubject): boolean {
        return subject.lot.participation !== null;
    }

    assessRisk(subject: LotSubject): RiskSignal {
        const { lot } = subject;
        const { minimumPricedBids, maxRelativeDifference } = this.definition.parameters;
        const threshold = { minimumPricedBids, maxRelativeDifference };

        // No per-bid rows at all — the same "report lists no usable
        // participants" gap LT-COM-10/LT-COM-11 handle.
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
        // any pair compared here is necessarily two different suppliers'
        // prices, never the same supplier's bid matched against itself.
        const prices = pricedBids.map((bid) => bid.pasiulymoKaina);
        const match = findClosestMatch(prices, maxRelativeDifference);

        return this.signalFor(subject, {
            state: match ? "triggered" : "not_triggered",
            rawValue: {
                pricedBids: pricedBids.length,
                relativeDifference: match?.relativeDifference ?? null,
                lowerPrice: match?.lowerPrice ?? null,
                higherPrice: match?.higherPrice ?? null,
            },
            threshold,
            appliedParameters: threshold,
        });
    }
}
