import type { ProcurementParticipation } from "../../../types.ts";

// Named participation scenarios shared by decision.test.ts. A Subject's
// participation counts come from the Procurement Reader's own consolidated
// procurement-grain batch query (modules/risk/procurementReader.ts) — these
// fixtures describe the expected Procurement.participation shape directly.
// The query's own cross-lot union correctness (the same supplier across two
// lots counting once, different suppliers per lot both counting) is tested
// once, in test/risk/procurementReader.it.ts.

export const REPORTED_AT = "2026-05-04T09:30:00Z";

// Exactly one distinct supplier across the whole procurement — below the
// minimumSuppliers: 2 default — the plain triggered case.
export const oneSupplier: ProcurementParticipation = { totalSuppliers: 1, reportedAt: REPORTED_AT };

// Exactly two distinct suppliers — the boundary, just outside the threshold
// (minimumSuppliers: 2 does not trigger on totalSuppliers === 2).
export const twoSuppliers: ProcurementParticipation = { totalSuppliers: 2, reportedAt: REPORTED_AT };

// Five distinct suppliers — the plain not_triggered case, well clear of the
// boundary.
export const fiveSuppliers: ProcurementParticipation = { totalSuppliers: 5, reportedAt: REPORTED_AT };

// A real, rarer case — every recorded tiekejoKodas is null-coded, rather
// than no participation being observed at all — produced by the real query
// too (test/risk/procurementReader.it.ts's "nullCoded" scenario), not just
// a decision-only fixture. Treated as an incomplete report, not zero
// suppliers.
export const emptyReport: ProcurementParticipation = { totalSuppliers: 0, reportedAt: REPORTED_AT };
