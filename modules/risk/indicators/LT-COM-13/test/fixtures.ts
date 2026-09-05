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

// The plain triggered case: the second-cheapest bid costs more than double
// the cheapest one (relativeGap 1.5, well above the 1.0 minRelativeGap).
export const wideGapBetweenTwoLowest: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 2500, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 9000, eileNumeris: 3 }),
];

// Right at the boundary: the second-cheapest is exactly double the
// cheapest (relativeGap exactly 1.0), still counts (inclusive >=).
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
export const noWideGap: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 10500, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 12000, eileNumeris: 3 }),
];

// Identical two lowest prices (relativeGap 0) must not trigger — no
// disparity at all between the cheapest offers.
export const identicalLowestPricesDoNotCount: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 9000, eileNumeris: 2 }),
];

// A high outlier bid further up the ranking must not change the outcome —
// only the two cheapest priced bids drive the gap, not the widest pair
// overall (unlike a raw min/max range, which this indicator deliberately
// avoids — see README).
export const outlierAboveSecondLowestIgnored: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 1050, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 50000, eileNumeris: 3 }),
];

// A disqualified bid's price still counts — the indicator judges submitted
// prices, not surviving ones.
export const disqualifiedBidStillCounted: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 1000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 2500, atmetimoPriezastis: "Netinkama kvalifikacija" }),
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
