import type { Bid, LotSubject, RiskSignal } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltCom10Definition } from "./definition.ts";

// LT-COM-10 — Identical bid prices: reads Subject.lot.bids (per-bid price)
// the same way LT-AWD-02 does. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

// A bid price of 0 or less is a data-quality artefact (e.g. an unparsed
// "NaN"/negative value from the source XLSX), not a genuine offer — same
// guard as LT-AWD-02's isUsablePrice, and for the same reason.
function isUsablePrice(bid: Bid): bid is Bid & { pasiulymoKaina: number } {
    return bid.pasiulymoKaina !== null && bid.pasiulymoKaina > 0;
}

export class LtCom10Decision extends ALotIndicatorDecision<typeof ltCom10Definition> {
    static readonly definition = ltCom10Definition;
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor(context: EvaluationContext) {
        super(ltCom10Definition, context);
    }

    protected hasRequiredData(subject: LotSubject): boolean {
        return subject.lot.participation !== null;
    }

    assessRisk(subject: LotSubject): RiskSignal {
        const { lot } = subject;
        const { minimumPricedBids } = this.definition.parameters;

        // No per-bid rows at all — the same "report lists no usable
        // participants" gap LT-AWD-01/LT-AWD-02 handle for their own shapes.
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

        // lot.bids is already one row per distinct tiekejoKodas (the
        // Procurement Reader's LOT_BIDS_SQL is DISTINCT ON tiekejoKodas), so
        // a price shared by >=2 pricedBids here is necessarily shared by
        // >=2 different suppliers, never the same supplier counted twice.
        const groupSizeByPrice = new Map<number, number>();
        for (const bid of pricedBids) {
            groupSizeByPrice.set(bid.pasiulymoKaina, (groupSizeByPrice.get(bid.pasiulymoKaina) ?? 0) + 1);
        }
        let largestIdenticalGroupSize = 0;
        let identicalPrice: number | null = null;
        for (const [price, size] of groupSizeByPrice) {
            if (size > largestIdenticalGroupSize) {
                largestIdenticalGroupSize = size;
                identicalPrice = price;
            }
        }

        const triggered = largestIdenticalGroupSize >= 2;
        return this.signalFor(subject, {
            state: triggered ? "triggered" : "not_triggered",
            rawValue: {
                pricedBids: pricedBids.length,
                largestIdenticalGroupSize,
                identicalPrice: triggered ? identicalPrice : null,
            },
            threshold: { minimumPricedBids },
            appliedParameters: { minimumPricedBids },
        });
    }
}
