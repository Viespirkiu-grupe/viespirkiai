import type { LotParticipation } from "../../../types.ts";

// Named participation scenarios shared by decision.test.ts. A Subject's
// participation counts come from the Procurement Reader's own consolidated
// batch query (modules/risk/procurementReader.ts) — the same query
// LT-COM-01 uses, since totalBids is identical between them. The query's own
// correctness is tested once, for every lot-grain indicator, in
// test/risk/procurementReader.it.ts.
//
// Unlike LT-COM-01, validBids has no bearing here: totalBids counts every
// distinct participant regardless of whether their bid was later rejected.

export const REPORTED_AT = "2026-05-04T09:30:00Z";

// Two participants — below the minimumBidders: 3 default — the plain
// triggered case.
export const twoBidders: LotParticipation = { totalBids: 2, validBids: 2, reportedAt: REPORTED_AT };

// Exactly three participants — the boundary, just inside the threshold
// (minimumBidders: 3 does not trigger on totalBids === 3).
export const threeBidders: LotParticipation = { totalBids: 3, validBids: 3, reportedAt: REPORTED_AT };

// Five participants — the plain not_triggered case, well clear of the
// boundary.
export const fiveBidders: LotParticipation = { totalBids: 5, validBids: 5, reportedAt: REPORTED_AT };

// A real, rarer case — every recorded tiekejoKodas is null-coded, rather
// than no participation being observed at all — produced by the real query
// too (test/risk/procurementReader.it.ts's "nullCoded" scenario), not just
// a decision-only fixture. Treated as an incomplete report, not zero
// participation.
export const emptyReport: LotParticipation = { totalBids: 0, validBids: 0, reportedAt: REPORTED_AT };
