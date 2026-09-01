import type { Bid } from "../../../types.ts";

// Named lot-level Bid scenarios shared by decision.test.ts. A BidSubject's
// lot.bids comes from the Procurement Reader's own bid-grain query
// (modules/risk/procurementReader.ts) — these fixtures describe the
// expected Bid shape directly. The query's own correctness is tested in
// test/risk/procurementReader.it.ts. Unlike LT-COM-20/LT-COM-21 (which judge
// one bid in isolation), LT-PRI-09 compares the winning bid against every
// other bid in the same lot, so each scenario here is the *whole lot's*
// bid array — decision.test.ts picks the winner (eileNumeris === 1) out of
// it as the Subject.bid under test.

export const REPORTED_AT = "2026-05-04T09:30:00Z";

function bid(overrides: Partial<Bid> & { tiekejoKodas: string }): Bid {
    return {
        eileNumeris: null,
        pasiulymoKaina: null,
        atmetimoPriezastis: null,
        atmetimoStatusas: null,
        atmetimoTeisinisPagrindas: null,
        reportedAt: REPORTED_AT,
        ...overrides,
    };
}

// The plain triggered case: the winner's price is less than half the
// second-lowest valid competitor's (relativeDiscount 1.5, well above the
// 1.0 minRelativeDiscount).
export const winnerHeavilyDiscounted: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 2500, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 9000, eileNumeris: 3 }),
];

// Right at the boundary: the second-lowest valid price is exactly double
// the winner's (relativeDiscount exactly 1.0), still counts (inclusive >=).
export const exactlyAtTolerance: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 2000, eileNumeris: 2 }),
];

// Just under the boundary: must not trigger.
export const justUnderTolerance: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 1999.5, eileNumeris: 2 }),
];

// Three suppliers priced close together — the plain not_triggered case.
export const noDiscount: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 10500, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 12000, eileNumeris: 3 }),
];

// A disqualified bid with a lower price than the runner-up must not count
// as the "second-lowest valid" comparator — OCP-R058 compares against the
// second-lowest *valid* bid, unlike LT-COM-13's raw second-lowest priced
// bid.
export const disqualifiedCheaperBidExcluded: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 1050, atmetimoPriezastis: "Netinkama kvalifikacija" }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 2500, eileNumeris: 2 }),
];

// Only the winner ever carried a usable, valid price — no competitor to
// compare against.
export const noOtherValidBid: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", atmetimoPriezastis: "Netinkama kvalifikacija" }),
];

// A "NaN"/negative parsing artefact from the source XLSX must not count as
// a usable competitor price.
export const invalidCompetitorPriceIgnored: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: -100 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: NaN }),
];

// No bid in the lot is ranked #1 (and unrejected) at all — no known winner,
// so the concept has no subject to judge, per domain-model.md §3's winner
// inference.
export const noKnownWinner: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", eileNumeris: null, atmetimoPriezastis: "Pavėluotas pasiūlymas" }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 9000, eileNumeris: 2 }),
];

// Ranked #1 but disqualified — not a real winner (domain-model.md §3).
export const rankedButDisqualified: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1, atmetimoPriezastis: "Netinkama kvalifikacija" }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 9000, eileNumeris: 2 }),
];

// The winner's own report row carries a ranking but no usable price — the
// genuine insufficient_data case.
export const winnerMissingPrice: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 9000, eileNumeris: 2 }),
];

// The offer ranking is the award ranking, not a price ranking: under a
// MEAT award the #1-ranked bid can legitimately cost more than a valid
// competitor. There is no discount to measure, so the concept does not
// apply — see decision.ts's isLowestValidPricedBid.
export const winnerNotCheapest: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 1000, eileNumeris: 2 }),
];

// Only a *valid* cheaper competitor takes the concept away: a cheaper bid
// that was disqualified was never a real alternative, so the winner is
// still the lowest valid price and the lot stays comparable.
export const cheaperCompetitorDisqualified: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 400, atmetimoPriezastis: "Neatitiko kvalifikacijos" }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 2500, eileNumeris: 2 }),
];

// A tie for the lowest valid price still leaves the winner *a* lowest
// valid bid — comparable, and a relative discount of exactly 0.
export const winnerTiedForLowest: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 1000, eileNumeris: 2 }),
];
