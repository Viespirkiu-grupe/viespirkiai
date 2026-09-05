import type { Bid } from "../../../types.ts";

// Named Bid scenarios shared by decision.test.ts. A LotSubject's lot.bids
// comes from the Procurement Reader's own bid-grain query
// (modules/risk/procurementReader.ts) — these fixtures describe the
// expected Bid shape directly. The query's own correctness is tested in
// test/risk/procurementReader.it.ts.

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

// The plain triggered case: one supplier's price is exactly double another's.
export const exactDoublePrice: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 2000, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 3300, eileNumeris: 3 }),
];

// Within the 0.5% tolerance of an exact triple — real prices carry cents.
export const nearTriplePriceWithinTolerance: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 100, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 300.4, eileNumeris: 2 }),
];

// Ratio is close to 3 but outside the allowed tolerance — must not trigger.
export const nearTripleOutsideTolerance: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 100, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 302, eileNumeris: 2 }),
];

// Three suppliers, no pair forming a round multiple — the plain not_triggered
// case.
export const noFixedMultiple: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 10500, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 12000, eileNumeris: 3 }),
];

// Identical prices (ratio 1) must not be mistaken for a "1x multiple" —
// LT-COM-10's own concept, not this indicator's.
export const identicalPricesDoNotCount: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 9000, eileNumeris: 2 }),
];

// A ratio of 8 sits outside maxMultiple (5) — too far from a "simple" round
// factor to count, even though it is an exact integer.
export const multipleBeyondCap: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 8000, eileNumeris: 2 }),
];

// Two unrelated pairs, only one of which forms a fixed multiple — the
// tightest match (smallest relative error) is the one reported.
export const tightestMatchAmongSeveralPairs: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 2001, eileNumeris: 2 }), // ratio 2.001, tighter
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 2990, eileNumeris: 3 }), // ratio to B1: 2.99, looser (would round to 3)
];

// A disqualified bid's price still counts — the indicator judges submitted
// prices, not surviving ones.
export const disqualifiedBidStillCounted: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 2000, atmetimoPriezastis: "Netinkama kvalifikacija" }),
];

// Only one bid ever carried a usable price — no comparison is possible.
export const onePricedBid: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", atmetimoPriezastis: "Netinkama kvalifikacija" }),
];

// A "NaN"/negative parsing artefact from the source XLSX must not count as a
// usable price.
export const invalidPricesIgnored: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: -100, atmetimoPriezastis: "Netinkama kvalifikacija" }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: NaN, atmetimoPriezastis: "Pavėluotas pasiūlymas" }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 12000, eileNumeris: 1 }),
];

// Bids were reported, but none of them carry a usable price at all.
export const noPricedBids: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", atmetimoPriezastis: "Netinkama kvalifikacija" }),
    bid({ tiekejoKodas: "B2", eileNumeris: 1 }),
];
