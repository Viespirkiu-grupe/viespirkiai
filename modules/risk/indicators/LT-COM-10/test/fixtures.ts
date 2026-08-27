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

// The plain triggered case: two different suppliers offered the exact same
// price.
export const twoIdenticalPrices: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 9000, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 12000, eileNumeris: 3 }),
];

// Three suppliers, all different prices — the plain not_triggered case.
export const allDistinctPrices: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 10500, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 12000, eileNumeris: 3 }),
];

// A larger identical-price group (three suppliers), alongside an unrelated
// pair that also happens to match each other — the largest group is the one
// reported.
export const threeWayTieAmongMore: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 5000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 5000, eileNumeris: 2 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 5000, eileNumeris: 3 }),
    bid({ tiekejoKodas: "B4", pasiulymoKaina: 7000, atmetimoPriezastis: "Netinkama kvalifikacija" }),
    bid({ tiekejoKodas: "B5", pasiulymoKaina: 7000, eileNumeris: 4 }),
];

// A disqualified bid still counts — the indicator judges submitted prices,
// not surviving ones.
export const disqualifiedBidStillCounted: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 9000, atmetimoPriezastis: "Netinkama kvalifikacija" }),
];

// Only one bid ever carried a usable price — no comparison is possible.
export const onePricedBid: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", atmetimoPriezastis: "Netinkama kvalifikacija" }),
];

// A "NaN"/negative parsing artefact from the source XLSX must not count as
// a usable price, and must not be treated as matching another such artefact.
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
