import type { LotParticipation } from "../../../types.ts";

// Named participation scenarios shared by decision.test.ts. A Subject's
// participation counts come from the Procurement Reader's own consolidated
// batch query (modules/risk/procurementReader.ts) — these fixtures describe
// the expected Lot.participation shape directly. The query's own correctness
// (dedup via DISTINCT, cutoff filtering, daliesNumeris handling) is tested
// once, for every lot-grain indicator, in test/risk/procurementReader.it.ts.

export const REPORTED_AT = "2026-05-04T09:30:00Z";

// Exactly one bidder, not rejected — the plain triggered case.
export const singleBidder: LotParticipation = { totalBids: 1, validBids: 1, reportedAt: REPORTED_AT };

// Two bidders submitted, one was rejected — still triggered: exactly one bid
// survived evaluation.
export const oneOfTwoRejected: LotParticipation = { totalBids: 2, validBids: 1, reportedAt: REPORTED_AT };

// Two bidders, neither rejected — not_triggered.
export const twoValidBidders: LotParticipation = { totalBids: 2, validBids: 2, reportedAt: REPORTED_AT };

// A participation row real ingestion cannot produce on its own (every
// tiekejoKodas would have to be NULL) — a decision-only case pinning what
// assessRisk() does with it regardless: treated as an incomplete report, not
// zero participation.
export const emptyReport: LotParticipation = { totalBids: 0, validBids: 0, reportedAt: REPORTED_AT };
