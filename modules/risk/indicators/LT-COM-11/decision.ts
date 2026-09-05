import type { Bid, LotSubject, RiskSignal } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltCom11Definition } from "./definition.ts";

// LT-COM-11 — Fixed-multiple bid prices: reads Subject.lot.bids (per-bid
// price) the same way LT-COM-10 does. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

// A bid price of 0 or less is a data-quality artefact (e.g. an unparsed
// "NaN"/negative value from the source XLSX), not a genuine offer — same
// guard LT-COM-10/LT-AWD-02 use, and for the same reason.
function isUsablePrice(bid: Bid): bid is Bid & { pasiulymoKaina: number } {
    return bid.pasiulymoKaina !== null && bid.pasiulymoKaina > 0;
}

type MultipleMatch = Readonly<{
    multiple: number;
    ratio: number;
    relativeError: number;
    lowerPrice: number;
    higherPrice: number;
}>;

// The tightest fixed-multiple match among every pair of distinct-supplier
// priced bids, or null if none of them land within tolerance of an integer
// multiple in [2, maxMultiple]. A ratio near 1 (near-identical prices,
// LT-COM-10's own concept) never matches here: round(ratio) would be 1,
// below the minimum multiple of 2.
function findTightestMultipleMatch(
    prices: readonly number[],
    maxMultiple: number,
    relativeTolerance: number,
): MultipleMatch | null {
    let best: MultipleMatch | null = null;
    for (let i = 0; i < prices.length; i++) {
        for (let j = i + 1; j < prices.length; j++) {
            const lowerPrice = Math.min(prices[i], prices[j]);
            const higherPrice = Math.max(prices[i], prices[j]);
            const ratio = higherPrice / lowerPrice;
            const multiple = Math.round(ratio);
            if (multiple < 2 || multiple > maxMultiple) {
                continue;
            }
            const relativeError = Math.abs(ratio - multiple) / multiple;
            if (relativeError > relativeTolerance) {
                continue;
            }
            if (best === null || relativeError < best.relativeError) {
                best = { multiple, ratio, relativeError, lowerPrice, higherPrice };
            }
        }
    }
    return best;
}

export class LtCom11Decision extends ALotIndicatorDecision<typeof ltCom11Definition> {
    static readonly definition = ltCom11Definition;
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor(context: EvaluationContext) {
        super(ltCom11Definition, context);
    }

    protected hasRequiredData(subject: LotSubject): boolean {
        return subject.lot.participation !== null;
    }

    assessRisk(subject: LotSubject): RiskSignal {
        const { lot } = subject;
        const { minimumPricedBids, maxMultiple, relativeTolerance } = this.definition.parameters;
        const threshold = { minimumPricedBids, maxMultiple, relativeTolerance };

        // No per-bid rows at all — the same "report lists no usable
        // participants" gap LT-COM-10/LT-AWD-01/LT-AWD-02 handle.
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
        const match = findTightestMultipleMatch(prices, maxMultiple, relativeTolerance);

        return this.signalFor(subject, {
            state: match ? "triggered" : "not_triggered",
            rawValue: {
                pricedBids: pricedBids.length,
                matchedMultiple: match?.multiple ?? null,
                ratio: match?.ratio ?? null,
                lowerPrice: match?.lowerPrice ?? null,
                higherPrice: match?.higherPrice ?? null,
            },
            threshold,
            appliedParameters: threshold,
        });
    }
}
