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
        reportedAt: REPORTED_AT,
        ...overrides,
    };
}

// The plain triggered case: the cheapest bid (B1, 9000) was disqualified;
// the winner (B2, 12000) is more expensive.
export const lowestDisqualified: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, atmetimoPriezastis: "Netinkama kvalifikacija" }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 12000, eileNumeris: 1 }),
];

// The plain not_triggered case: nothing was disqualified.
export const noneDisqualified: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 12000, eileNumeris: 2 }),
];

// A higher-priced bid was disqualified, not the cheapest one — not_triggered.
export const higherPriceDisqualified: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 12000, atmetimoPriezastis: "Netinkama kvalifikacija" }),
];

// Every priced bid was disqualified — total failure, not "the lowest was
// shut out in favour of a pricier survivor" (there is no survivor).
export const allDisqualified: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, atmetimoPriezastis: "Netinkama kvalifikacija" }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 12000, atmetimoPriezastis: "Pavėluotas pasiūlymas" }),
];

// Two bidders tie for the lowest price; one is disqualified but the other
// survives at the same price — the lowest price itself was not shut out.
export const tiedLowestOneSurvives: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, atmetimoPriezastis: "Netinkama kvalifikacija" }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 12000, eileNumeris: 2 }),
];

// Two bidders tie for the lowest price and both are disqualified; a pricier
// bid survives — triggers, same as the plain case but with a tied pair.
export const tiedLowestBothDisqualified: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, atmetimoPriezastis: "Netinkama kvalifikacija" }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 9000, atmetimoPriezastis: "Pavėluotas pasiūlymas" }),
    bid({ tiekejoKodas: "B3", pasiulymoKaina: 12000, eileNumeris: 1 }),
];

// Only one bid ever carried a usable price — no comparison is possible.
export const onePricedBid: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: 9000, eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", atmetimoPriezastis: "Netinkama kvalifikacija" }),
];

// A "NaN"/negative parsing artefact from the source XLSX must not count as
// a usable price, or as the minimum.
export const invalidPriceIgnored: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", pasiulymoKaina: -100, atmetimoPriezastis: "Netinkama kvalifikacija" }),
    bid({ tiekejoKodas: "B2", pasiulymoKaina: 12000, eileNumeris: 1 }),
];

// Bids were reported, but none of them carry a usable price at all.
export const noPricedBids: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", atmetimoPriezastis: "Netinkama kvalifikacija" }),
    bid({ tiekejoKodas: "B2", eileNumeris: 1 }),
];
