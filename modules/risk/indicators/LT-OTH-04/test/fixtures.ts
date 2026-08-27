import type { ProcurementProcedureOutcome } from "../../../types.ts";

// Named procedure-outcome scenarios shared by decision.test.ts. A Subject's
// procedureOutcome/contractSignatureDates come from the Procurement Reader's
// own consolidated procurement-grain batch queries
// (modules/risk/procurementReader.ts, public.v_pirkimo_pabaiga_v2 and
// public.v_pirkimo_sutartys_v2) — these fixtures describe the expected
// shape directly. The queries' own behaviour is tested in
// test/risk/procurementReader.it.ts.

const CONCLUDED = "Sudarius pirkimo sutartį";

// One concluded lot, decided 2026-01-01, paired with a contract signed
// 2026-01-12 — 11 days, squarely inside maximumDays: 36, the plain
// not_triggered case.
export const oneLotOrdinaryPeriod: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-01-01" }],
    reportedAt: "2026-01-01",
    isFramework: null,
};
export const oneLotOrdinaryPeriodSignatures: readonly string[] = ["2026-01-12"];

// One concluded lot, decided 2026-01-01, paired with a contract signed the
// same day — 0 days, not_triggered.
export const oneLotSignedSameDay: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-01-01" }],
    reportedAt: "2026-01-01",
    isFramework: null,
};
export const oneLotSignedSameDaySignatures: readonly string[] = ["2026-01-01"];

// One concluded lot, decided 2026-01-01, paired with a contract signed
// exactly 36 days later — the boundary; 36 is not "strictly above"
// maximumDays: 36, so not_triggered.
export const oneLotAtMaximumBoundary: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-01-01" }],
    reportedAt: "2026-01-01",
    isFramework: null,
};
export const oneLotAtMaximumBoundarySignatures: readonly string[] = ["2026-02-06"];

// One concluded lot, decided 2026-01-01, paired with a contract signed 37
// days later — anomalously long (above maximumDays: 36).
export const oneLotSignedLate: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-01-01" }],
    reportedAt: "2026-01-01",
    isFramework: null,
};
export const oneLotSignedLateSignatures: readonly string[] = ["2026-02-07"];

// Two lots of the same procurement, decided 12 days apart: lot "0" pairs
// with the earlier of two candidate signatures (11 days, ordinary), lot "1"
// pairs with the later one (47 days, anomalous) because the earlier
// signature now predates its own decision date — different decision dates
// are what makes the two lots pick different signatures at all; two lots
// sharing one decision date would both pick the same nearest signature.
// Triggers, since only one lot needs to breach the bound (LT-OTH-03's "any
// lot" aggregation, not LT-OTH-05's "every lot must fail").
export const mixedLotsOneAnomalous: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [
        { daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-01-01" },
        { daliesNumeris: "1", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-01-13" },
    ],
    reportedAt: "2026-01-13",
    isFramework: null,
};
export const mixedLotsOneAnomalousSignatures: readonly string[] = ["2026-01-12", "2026-03-01"];

// One lot terminated before any evaluation could happen, and no concluded
// lot at all — insufficient_data, mirroring LT-OTH-03/LT-OTH-05.
export const onlyTerminated: ProcurementProcedureOutcome = {
    lotOutcomes: ["Nutraukus pirkimo ar projekto konkurso procedūras"],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: "Nutraukus pirkimo ar projekto konkurso procedūras", sprendimoPriemimoData: "2025-12-15" }],
    reportedAt: "2025-12-15",
    isFramework: null,
};

// One concluded lot with a real decision date, but every contract this
// procurement's pirkimoNumeris resolves to was signed BEFORE that date — the
// dirty/reused-pirkimoNumeris case README.md documents (a contract that
// happens to share the same pirkimoNumeris as an unrelated, later
// procedure). Excluded from the period calculation entirely, not counted as
// a fabricated negative-period trigger — insufficient_data, since no other
// lot pairs successfully either.
export const onlyContractPredatesDecision: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-01-01" }],
    reportedAt: "2026-01-01",
    isFramework: null,
};
export const onlyContractPredatesDecisionSignatures: readonly string[] = ["2020-11-04"];

// One concluded lot, but its decision date was never recorded — still
// insufficient_data, the same as no procedure-ending decision at all.
export const oneLotConcludedNoDate: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: null }],
    reportedAt: null,
    isFramework: null,
};
