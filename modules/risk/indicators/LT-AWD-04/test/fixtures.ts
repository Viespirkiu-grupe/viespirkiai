import type { LotParticipation } from "../../../types.ts";

// Named participation scenarios shared by decision.test.ts. A Subject's
// participation counts come from the Procurement Reader's own consolidated
// batch query (modules/risk/procurementReader.ts), the same query
// LT-COM-01/LT-COM-02/LT-AWD-01 use.

export const REPORTED_AT = "2026-05-04T09:30:00Z";

// Four bidders, one survives — 75% disqualified, well past both the
// minimumTotalBids: 3 gate and the disqualifiedShareThreshold: 0.5 — the
// plain triggered case.
export const fourBiddersOneSurvivor: LotParticipation = { totalBids: 4, validBids: 1, reportedAt: REPORTED_AT };

// Four bidders, exactly two survive — the boundary, exactly at
// disqualifiedShareThreshold: 0.5 (>= is inclusive, so this triggers).
export const fourBiddersHalfSurvive: LotParticipation = { totalBids: 4, validBids: 2, reportedAt: REPORTED_AT };

// Four bidders, three survive — just inside the threshold (25% disqualified),
// the plain not_triggered case.
export const fourBiddersThreeSurvive: LotParticipation = { totalBids: 4, validBids: 3, reportedAt: REPORTED_AT };

// Two bidders, one disqualified — a 50% share that would trigger if the
// minimumTotalBids: 3 gate did not apply first; proves the gate, not just
// the share threshold, is enforced.
export const twoBiddersOneSurvivor: LotParticipation = { totalBids: 2, validBids: 1, reportedAt: REPORTED_AT };

// A real, rarer case — every recorded tiekejoKodas is null-coded, rather
// than no participation being observed at all. Treated as an incomplete
// report, not zero participation.
export const emptyReport: LotParticipation = { totalBids: 0, validBids: 0, reportedAt: REPORTED_AT };
