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

// The plain triggered case: two suppliers' prices are 0.5% apart — well
// within the 1% maxRelativeDifference.
export const veryCloseButNotIdentical: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 1005, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 3300, eileNumeris: 3 }),
];

// Right at the boundary: exactly 1% apart, still counts (inclusive <=).
export const exactlyAtTolerance: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 1010, eileNumeris: 2 }),
];

// Just over the boundary: must not trigger.
export const justOverTolerance: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 1010.5, eileNumeris: 2 }),
];

// Three suppliers, no pair close enough — the plain not_triggered case.
export const noCloseBids: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 10500, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 12000, eileNumeris: 3 }),
];

// Identical prices (relative difference 0) must not be mistaken for
// "suspiciously close" — LT-COM-10's own, stronger concept, not this one's.
export const identicalPricesDoNotCount: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 9000, eileNumeris: 2 }),
];

// Two unrelated pairs, only one of which is close enough — the tightest
// match (smallest relative difference) is the one reported.
export const tightestMatchAmongSeveralPairs: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }), // 0.2% from B2
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 1002, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 1009, eileNumeris: 3 }), // 0.9% from B1, looser
];

// A disqualified bid's price still counts — the indicator judges submitted
// prices, not surviving ones.
export const disqualifiedBidStillCounted: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 1005, atmetimoPriezastis: "Netinkama kvalifikacija" }),
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
