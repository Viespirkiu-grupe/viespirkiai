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

// The plain not_triggered case: nothing was disqualified.
export const noneDisqualified: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", eileNumeris: 1 }),
    bid({ tiekejoKodas: "B2", eileNumeris: 2 }),
];

// A disqualification citing a specific statutory legal basis — well
// supported, not_triggered.
export const disqualifiedWithSpecificBasis: readonly Bid[] = [
    bid({
        tiekejoKodas: "B1",
        atmetimoPriezastis: "Neatitiko kvalifikacijos reikalavimų",
        atmetimoTeisinisPagrindas: "VPĮ 45 str. 1 d. 5 p.",
    }),
    bid({ tiekejoKodas: "B2", eileNumeris: 1 }),
];

// A disqualification with no legal basis recorded at all — poorly
// supported, triggered.
export const disqualifiedWithNoBasis: readonly Bid[] = [
    bid({ tiekejoKodas: "B1", atmetimoPriezastis: "Neatitiko kvalifikacijos reikalavimų" }),
    bid({ tiekejoKodas: "B2", eileNumeris: 1 }),
];

// A disqualification whose legal basis is the generic "Kita" (Other)
// catch-all, naming no specific statutory ground — poorly supported,
// triggered.
export const disqualifiedWithWeakBasis: readonly Bid[] = [
    bid({
        tiekejoKodas: "B1",
        atmetimoPriezastis: "Pasiūlymas neatitinka pirkimo dokumentų reikalavimų",
        atmetimoTeisinisPagrindas: "Kita",
    }),
    bid({ tiekejoKodas: "B2", eileNumeris: 1 }),
];

// One well-supported and one poorly-supported disqualification in the same
// lot — a single poorly-supported disqualification is itself the concept
// this indicator flags, regardless of how the others were handled.
export const mixedDisqualifications: readonly Bid[] = [
    bid({
        tiekejoKodas: "B1",
        atmetimoPriezastis: "Neatitiko kvalifikacijos reikalavimų",
        atmetimoTeisinisPagrindas: "VPĮ 45 str. 1 d. 5 p.",
    }),
    bid({ tiekejoKodas: "B2", atmetimoPriezastis: "Pasiūlymas neatitinka pirkimo dokumentų reikalavimų" }),
    bid({ tiekejoKodas: "B3", eileNumeris: 1 }),
];
