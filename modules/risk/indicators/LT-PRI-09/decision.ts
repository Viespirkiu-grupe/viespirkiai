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
// the offer ranking (pasiūlymų eilė) and not rejected. Not recorded as such
// anywhere in the source data, so this is an approximation — see
// definition.ts's limitationLt — not a verified "this bid was awarded the
// contract" fact.
function isWinner(bid: Bid): boolean {
    return bid.eileNumeris === 1 && isValid(bid);
}

// Whether no other valid, usably-priced bid in the lot undercuts the
// winner. The offer ranking is the *award* ranking, not a price ranking:
// under an economically-most-advantageous-tender (MEAT) award the buyer
// scores quality alongside price, so the bid ranked #1 legitimately need
// not be the cheapest one. Measured against the full batch (run 676),
// 495 of 4,267 comparable lots — 11.6% — have a valid competitor priced
// below the winner, and those lots are three times likelier to carry a
// scoring column (ppa."pasiulymuEile"."kainosSantykis") than the lots
// where the winner is cheapest, which is what a MEAT award looks like in
// this data.
//
// OCP-R058's statistic — "(second-lowest valid bid − winning bid) /
// winning bid" — presupposes the winner *is* the price leader; where it is
// not, there is no discount to measure and the subtraction just yields a
// negative number that can never trigger. Gating those lots out (see
// isEligible) rather than letting them resolve to not_triggered keeps the
// indicator from asserting "evaluated, no red flag" about a lot whose
// premise it never satisfied — and makes assessRisk's
// `secondLowestValidPrice` genuinely the *second*-lowest valid price,
// since the winner is then provably the lowest.
function isLowestValidPricedBid(bid: Bid & { pasiulymoKaina: number }, lot: BidSubject["lot"]): boolean {
    return !lot.bids.some(
        (other) =>
            other.tiekejoKodas !== bid.tiekejoKodas &&
            isValid(other) &&
            isUsablePrice(other) &&
            other.pasiulymoKaina < bid.pasiulymoKaina,
    );
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

        // hasRequiredData just proved the winner's own price is usable.
        if (!isLowestValidPricedBid(subject.bid as Bid & { pasiulymoKaina: number }, subject.lot)) {
            return { eligible: false, signal: this.signalFor(subject, { state: "not_applicable" }) };
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
        // isEligible has already proved the winner is the lowest valid
        // priced bid, so the cheapest of the others is the *second*-lowest
        // valid price in the lot, and relativeDiscount is never negative.
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
