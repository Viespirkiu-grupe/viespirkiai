import type { Bid } from "../../../types.ts";

// Named Bid scenarios shared by decision.test.ts. A Subject.bid comes from
// the Procurement Reader's own bid-grain query (modules/risk/procurementReader.ts)
// — these fixtures describe the expected Bid shape directly. The query's own
// correctness (DISTINCT ON dedup, cutoff filtering, tiekejoKodas presence) is
// tested in test/risk/procurementReader.it.ts.

export const REPORTED_AT = "2026-05-04T09:30:00Z";

export const WITHDRAWN_STATUS =
    "Dalyvis (kandidatas) pasiūlymus (galutinius pasiūlymus) atsiėmė iki pasiūlymų eilės sudarymo";

// The plain triggered case: the ATN-1 report's own structured status says
// this bidder withdrew.
export const withdrawnBid: Bid = {
    tiekejoKodas: "B1",
    eileNumeris: null,
    pasiulymoKaina: null,
    atmetimoPriezastis: null,
    atmetimoStatusas: WITHDRAWN_STATUS,
    reportedAt: REPORTED_AT,
};

// Ranked and never rejected — the plain not_triggered case.
export const rankedBid: Bid = {
    tiekejoKodas: "B2",
    eileNumeris: 1,
    pasiulymoKaina: 15000,
    atmetimoPriezastis: null,
    atmetimoStatusas: null,
    reportedAt: REPORTED_AT,
};

// Rejected by the buyer for cause (price too high) — not a self-withdrawal,
// so not_triggered, distinct from withdrawnBid.
export const rejectedForCauseBid: Bid = {
    tiekejoKodas: "B3",
    eileNumeris: null,
    pasiulymoKaina: null,
    atmetimoPriezastis: "Pasiūlyta per didelė, perkančiajai organizacijai nepriimtina kaina",
    atmetimoStatusas: "Dalyvio pasiūlymas buvo atmestas",
    reportedAt: REPORTED_AT,
};

// A real, rarer case seen in the warehouse (v_dalyviai_v2's LATERAL join
// produces both at once for the same participant): ranked, but also carries
// a withdrawal status. The structured status is what LT-COM-20 reads, so
// this still triggers.
export const rankedThenWithdrawnBid: Bid = {
    tiekejoKodas: "B4",
    eileNumeris: 2,
    pasiulymoKaina: 9135,
    atmetimoPriezastis: null,
    atmetimoStatusas: WITHDRAWN_STATUS,
    reportedAt: REPORTED_AT,
};

// The participant row exists (xlsxPPAdalyviai), but the LATERAL offer-detail
// join found neither a ranking nor a rejection outcome for them — the
// insufficient_data case.
export const noOutcomeBid: Bid = {
    tiekejoKodas: "B5",
    eileNumeris: null,
    pasiulymoKaina: null,
    atmetimoPriezastis: null,
    atmetimoStatusas: null,
    reportedAt: REPORTED_AT,
};
