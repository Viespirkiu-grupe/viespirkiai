import type { ProcurementProcedureOutcome } from "../../../types.ts";

// Named procedure-outcome scenarios shared by decision.test.ts. A Subject's
// procedureOutcome comes from the Procurement Reader's own consolidated
// procurement-grain batch query (modules/risk/procurementReader.ts,
// public.v_pirkimo_pabaiga_v2) — these fixtures describe the expected
// Procurement.procedureOutcome shape directly. The query's own per-lot
// (outcome, decision date) correlation is tested in
// test/risk/procurementReader.it.ts.

const CONCLUDED = "Sudarius pirkimo sutartį";

// Deadline every scenario below measures against — 2026-01-01.
export const DEADLINE = "2026-01-01 06:00:00";

// One concluded lot, decided 30 days after the deadline — squarely inside
// [minimumDays, maximumDays], the plain not_triggered case.
export const oneLotOrdinaryPeriod: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-01-31", sprendimoPriezastys: null }],
    reportedAt: "2026-01-31",
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// One concluded lot, decided the same day as the deadline — anomalously
// short (0 days, below minimumDays: 3).
export const oneLotDecidedSameDay: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-01-01", sprendimoPriezastys: null }],
    reportedAt: "2026-01-01",
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// One concluded lot, decided before the deadline — an even more extreme
// case of "anomalously short" (a negative period), which real data shows
// happens for genuinely concluded lots at a low but non-zero rate (see
// README.md's 2026-08 measurement).
export const oneLotDecidedBeforeDeadline: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2025-12-20", sprendimoPriezastys: null }],
    reportedAt: "2025-12-20",
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// One concluded lot, decided exactly at the boundary — 3 days is not
// "strictly below" minimumDays, so this is not_triggered.
export const oneLotAtMinimumBoundary: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-01-04", sprendimoPriezastys: null }],
    reportedAt: "2026-01-04",
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// One concluded lot, decided 121 days after the deadline — anomalously long
// (above maximumDays: 120).
export const oneLotDecidedLate: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-05-02", sprendimoPriezastys: null }],
    reportedAt: "2026-05-02",
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// One concluded lot, decided exactly at the boundary — 120 days is not
// "strictly above" maximumDays, so this is not_triggered.
export const oneLotAtMaximumBoundary: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-05-01", sprendimoPriezastys: null }],
    reportedAt: "2026-05-01",
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// Two lots: one ordinary, one anomalously long — triggers, since only one
// lot needs to breach a bound (unlike LT-OTH-05's "every lot must fail"
// formula, a single anomalous lot is itself the finding here).
export const mixedLotsOneAnomalous: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [
        { daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-01-31", sprendimoPriezastys: null },
        { daliesNumeris: "1", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: "2026-06-01", sprendimoPriezastys: null },
    ],
    reportedAt: "2026-06-01",
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// One lot terminated before the deadline (a common, benign pattern — the
// buyer cancelled before any evaluation could happen) and no concluded lot
// at all — insufficient_data, since there is no genuine evaluation period to
// measure (see definition.ts's limitationLt).
export const onlyTerminatedBeforeDeadline: ProcurementProcedureOutcome = {
    lotOutcomes: ["Nutraukus pirkimo ar projekto konkurso procedūras"],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: "Nutraukus pirkimo ar projekto konkurso procedūras", sprendimoPriemimoData: "2025-12-15", sprendimoPriezastys: null }],
    reportedAt: "2025-12-15",
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// One concluded lot, but its decision date was never recorded — still
// insufficient_data, the same as no procedure-ending decision at all.
export const oneLotConcludedNoDate: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: null, sprendimoPriezastys: null }],
    reportedAt: null,
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};
