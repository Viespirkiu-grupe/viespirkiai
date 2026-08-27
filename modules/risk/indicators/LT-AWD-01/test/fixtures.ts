import type { LotParticipation } from "../../../types.ts";

// Named participation scenarios shared by decision.test.ts. Same Reader
// shape LT-COM-01 fixtures use (modules/risk/procurementReader.ts) — see
// its test/fixtures.ts for the query-correctness note.

export const REPORTED_AT = "2026-05-04T09:30:00Z";

// Three bidders submitted, two were rejected — the plain triggered case:
// multiple bids came in, only the winner survived.
export const twoOfThreeRejected: LotParticipation = { totalBids: 3, validBids: 1, reportedAt: REPORTED_AT };

// Exactly one bidder, not rejected — not_triggered here (contrast with
// LT-COM-01, which triggers on this same shape): only one bid was ever
// submitted, nothing was disqualified.
export const singleBidder: LotParticipation = { totalBids: 1, validBids: 1, reportedAt: REPORTED_AT };

// Two bidders, neither rejected — not_triggered: no disqualification at all.
export const twoValidBidders: LotParticipation = { totalBids: 2, validBids: 2, reportedAt: REPORTED_AT };

// Two bidders, one rejected — the boundary: exactly minimumTotalBids and
// exactly survivingValidBids.
export const oneOfTwoRejected: LotParticipation = { totalBids: 2, validBids: 1, reportedAt: REPORTED_AT };

// Three bidders, all rejected — not_triggered: no bid survived to stand in
// as "the winner", so this is total disqualification, not "all but the
// winner".
export const allRejected: LotParticipation = { totalBids: 3, validBids: 0, reportedAt: REPORTED_AT };

// A real, rarer case — every recorded tiekejoKodas is null-coded, rather
// than no participation being observed at all. Treated as an incomplete
// report, not zero participation.
export const emptyReport: LotParticipation = { totalBids: 0, validBids: 0, reportedAt: REPORTED_AT };
