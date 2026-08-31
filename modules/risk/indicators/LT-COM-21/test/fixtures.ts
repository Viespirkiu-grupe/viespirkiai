import type { Bid } from "../../../types.ts";

// Named Bid scenarios shared by decision.test.ts. A Subject.bid comes from
// the Procurement Reader's own bid-grain query (modules/risk/procurementReader.ts)
// — these fixtures describe the expected Bid shape directly. The query's own
// correctness (DISTINCT ON dedup, cutoff filtering, tiekejoKodas presence) is
// tested in test/risk/procurementReader.it.ts.

export const REPORTED_AT = "2026-05-04T09:30:00Z";

export const NON_CONFORMING_BASIS = "VPĮ 45 str. 1 d. 1 p.";
export const UNQUALIFIED_BASIS = "VPĮ 45 str. 1 d. 3 p.";
export const UNCLARIFIED_BASIS = "VPĮ 45 str. 1 d. 4 p.";
export const PRICE_BASIS = "VPĮ 45 str. 1 d. 5 p.";

// The plain triggered case: disqualified as not conforming to the tender
// documents' own requirements.
export const nonConformingBid: Bid = {
    tiekejoKodas: "B1",
    eileNumeris: null,
    pasiulymoKaina: null,
    atmetimoPriezastis: "Pasiūlymas neatitinka pirkimo dokumentuose nustatytų reikalavimų",
    atmetimoStatusas: "Dalyvio pasiūlymas buvo atmestas",
    atmetimoTeisinisPagrindas: NON_CONFORMING_BASIS,
    reportedAt: REPORTED_AT,
};

// Also triggers: disqualified for failing the tender's qualification
// requirements — the "incapable bidder" reading of the catalogue concept.
export const unqualifiedBid: Bid = {
    tiekejoKodas: "B2",
    eileNumeris: null,
    pasiulymoKaina: null,
    atmetimoPriezastis: "Neatitinka kvalifikacinių reikalavimų",
    atmetimoStatusas: "Dalyvio pasiūlymas buvo atmestas",
    atmetimoTeisinisPagrindas: UNQUALIFIED_BASIS,
    reportedAt: REPORTED_AT,
};

// Also triggers: the buyer asked for clarification/supplementation and the
// bidder did not respond in time — the "unexpectedly incomplete" reading.
export const unclarifiedBid: Bid = {
    tiekejoKodas: "B3",
    eileNumeris: null,
    pasiulymoKaina: null,
    atmetimoPriezastis: "Per nustatytą terminą nepateikė patikslintų dokumentų",
    atmetimoStatusas: "Dalyvio pasiūlymas buvo atmestas",
    atmetimoTeisinisPagrindas: UNCLARIFIED_BASIS,
    reportedAt: REPORTED_AT,
};

// Ranked and never rejected — the plain not_triggered case.
export const rankedBid: Bid = {
    tiekejoKodas: "B4",
    eileNumeris: 1,
    pasiulymoKaina: 15000,
    atmetimoPriezastis: null,
    atmetimoStatusas: null,
    atmetimoTeisinisPagrindas: null,
    reportedAt: REPORTED_AT,
};

// Rejected by the buyer for cause, but on a price ground rather than a
// non-genuine/incomplete/incapable one — the boundary against a similarly
// disqualified but out-of-scope bid.
export const priceRejectedBid: Bid = {
    tiekejoKodas: "B5",
    eileNumeris: null,
    pasiulymoKaina: null,
    atmetimoPriezastis: "Pasiūlyta per didelė, perkančiajai organizacijai nepriimtina kaina",
    atmetimoStatusas: "Dalyvio pasiūlymas buvo atmestas",
    atmetimoTeisinisPagrindas: PRICE_BASIS,
    reportedAt: REPORTED_AT,
};

// Disqualified, but the report's structured legal-basis dropdown was left
// empty or generic ("Kita") — LT-AWD-03's territory, not this indicator's:
// a poorly-supported disqualification is not evidence of any specific
// ground, so it stays not_triggered here.
export const disqualifiedWithoutLegalBasisBid: Bid = {
    tiekejoKodas: "B6",
    eileNumeris: null,
    pasiulymoKaina: null,
    atmetimoPriezastis: "Pasiūlymų atmetimas",
    atmetimoStatusas: "Dalyvio pasiūlymas buvo atmestas",
    atmetimoTeisinisPagrindas: null,
    reportedAt: REPORTED_AT,
};

// The participant row exists (xlsxPPAdalyviai), but the LATERAL offer-detail
// join found neither a ranking nor a rejection outcome for them — the
// insufficient_data case.
export const noOutcomeBid: Bid = {
    tiekejoKodas: "B7",
    eileNumeris: null,
    pasiulymoKaina: null,
    atmetimoPriezastis: null,
    atmetimoStatusas: null,
    atmetimoTeisinisPagrindas: null,
    reportedAt: REPORTED_AT,
};
