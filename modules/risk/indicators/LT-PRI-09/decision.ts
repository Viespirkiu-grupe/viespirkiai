import type { Bid, BidSubject, EligibilityOutcome, RiskSignal } from "../../types.ts";
import { ABidIndicatorDecision } from "../../procurementLotDecision.ts";
import { lotEligibility } from "../../procurementEligibility.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltPri09Definition } from "./definition.ts";

// LT-PRI-09 — Heavily discounted bid: judges one supplier's individual bid
// — specifically the lot's winning bid — against the lot's other bids
// (Subject.lot.bids, the same shape LT-COM-10…LT-COM-13 already read at lot
// grain). See docs/indicators-story/risk-service-architecture.md §1.2/§3.4
// and docs/indicators-story/domain-model.md §1.1 ("v_dalyviai" subject
// entity) / §3 (winner inference: eileNumeris = 1 and not rejected).

// A bid price of 0 or less is a data-quality artefact (e.g. an unparsed
// "NaN"/negative value from the source XLSX), not a genuine offer — same
// guard LT-COM-10…LT-COM-13/LT-AWD-02 use, and for the same reason.
function isUsablePrice(bid: Bid): bid is Bid & { pasiulymoKaina: number } {
    return bid.pasiulymoKaina !== null && bid.pasiulymoKaina > 0;
}

function isValid(bid: Bid): boolean {
    return bid.atmetimoPriezastis === null;
}

// The domain model's own winner inference (domain-model.md §3): first in
// the price ranking and not rejected. Not recorded as such anywhere in the
// source data, so this is an approximation — see definition.ts's
// limitationLt — not a verified "this bid was awarded the contract" fact.
function isWinner(bid: Bid): boolean {
    return bid.eileNumeris === 1 && isValid(bid);
}

export class LtPri09Decision extends ABidIndicatorDecision<typeof ltPri09Definition> {
    static readonly definition = ltPri09Definition;
    protected readonly missingDataWhenAbsent = ["pasiulymoKaina"];

    constructor(context: EvaluationContext) {
        super(ltPri09Definition, context);
    }

    // Only a lot's winning bid is a genuine instance of this catalogue
    // concept (OCP-R058: "the winner is also flagged") — a losing bid being
    // cheap carries no execution risk, since it was never awarded anything.
    // Every other bid in the lot is not_applicable, following LT-PRO-08's
    // precedent for a business-rule gate beyond the shared eligibility
    // decision.
    isEligible(subject: BidSubject): EligibilityOutcome {
        if (subject.subjectType !== "bid") {
            throw new Error(`${this.id}: expected a bid subject, got ${subject.subjectType}`);
        }

        const gate = lotEligibility(subject.lot, subject.procurement);
        if (!gate.eligible) {
            return { eligible: false, signal: this.signalFor(subject, gate.decision) };
        }

        if (!isWinner(subject.bid)) {
            return { eligible: false, signal: this.signalFor(subject, { state: "not_applicable" }) };
        }

        if (!this.hasRequiredData(subject)) {
            return {
                eligible: false,
                signal: this.signalFor(subject, {
                    state: "insufficient_data",
                    missingData: [...this.missingDataWhenAbsent],
                }),
            };
        }

        return { eligible: true };
    }

    // isEligible already proved this bid is the winner; the only remaining
    // gap is whether its own price is usable at all. Too few valid
    // competitors to compute a second-lowest price is not a data gap — see
    // assessRisk's not_triggered branch, mirroring LT-COM-13's own
    // minimumPricedBids handling.
    protected hasRequiredData(subject: BidSubject): boolean {
        return isUsablePrice(subject.bid);
    }

    assessRisk(subject: BidSubject): RiskSignal {
        const { bid, lot } = subject;
        const { minimumValidBids, minRelativeDiscount } = this.definition.parameters;
        const threshold = { minimumValidBids, minRelativeDiscount };
        // hasRequiredData already proved this.
        const winningPrice = bid.pasiulymoKaina!;

        const validPricedBids = lot.bids.filter(isUsablePrice).filter(isValid);
        if (validPricedBids.length < minimumValidBids) {
            return this.signalFor(subject, {
                state: "not_triggered",
                rawValue: { validBids: validPricedBids.length },
                threshold,
                appliedParameters: threshold,
            });
        }

        // lot.bids is already one row per distinct tiekejoKodas (the
        // Procurement Reader's LOT_BIDS_SQL is DISTINCT ON tiekejoKodas), so
        // this excludes exactly the winner itself, never double-counts it.
        const otherValidPrices = validPricedBids
            .filter((b) => b.tiekejoKodas !== bid.tiekejoKodas)
            .map((b) => b.pasiulymoKaina);
        const secondLowestValidPrice = Math.min(...otherValidPrices);
        const relativeDiscount = (secondLowestValidPrice - winningPrice) / winningPrice;
        const triggered = relativeDiscount >= minRelativeDiscount;

        return this.signalFor(subject, {
            state: triggered ? "triggered" : "not_triggered",
            rawValue: { validBids: validPricedBids.length, winningPrice, secondLowestValidPrice, relativeDiscount },
            threshold,
            appliedParameters: threshold,
        });
    }
}
