import type { ProcurementProcedureOutcome } from "../../../types.ts";

// Named procedure-outcome scenarios shared by decision.test.ts. A Subject's
// procedureOutcome comes from the Procurement Reader's own consolidated
// procurement-grain batch query (modules/risk/procurementReader.ts,
// public.v_pirkimo_pabaiga_v2) — these fixtures describe the expected
// Procurement.procedureOutcome shape directly. The query's own cross-lot
// aggregation correctness is tested once, in test/risk/procurementReader.it.ts.

export const REPORTED_AT = "2026-05-04";
const CONCLUDED =
    "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją";
const UNSUCCESSFUL = "Nutraukus pirkimo ar projekto konkurso procedūras";

// One lot, decision reason stated — the plain not_triggered case.
export const oneLotDocumented: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [
        {
            daliesNumeris: "0",
            proceduruPabaiga: CONCLUDED,
            sprendimoPriemimoData: REPORTED_AT,
            sprendimoPriezastys: "Ekonomiškai naudingiausias pasiūlymas",
        },
    ],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// One lot, decision reason left blank — the plain triggered case. Applies
// regardless of the outcome label itself: an unsuccessful outcome with no
// stated reason is exactly OLAF-CA06's concept, but the real data shows even
// "concluded" outcomes sometimes carry no reason text (see README.md's
// 2026-08 measurement) — the catalogue concept (STT-I15) is documentation
// completeness, not success/failure.
export const oneLotUndocumented: ProcurementProcedureOutcome = {
    lotOutcomes: [UNSUCCESSFUL],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: UNSUCCESSFUL, sprendimoPriemimoData: REPORTED_AT, sprendimoPriezastys: null }],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// A concluded (successful) outcome with no stated reason — proves the
// formula is not collinear with the outcome label.
export const oneLotConcludedButUndocumented: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: REPORTED_AT, sprendimoPriezastys: null }],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// Blank reason text ("" or whitespace-only) counts the same as a NULL
// column — the report form allows a submitted-but-empty field.
export const oneLotBlankReason: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED],
    lots: [{ daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: REPORTED_AT, sprendimoPriezastys: "   " }],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// Two lots, both documented — not_triggered.
export const twoLotsBothDocumented: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED, UNSUCCESSFUL],
    lots: [
        { daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: REPORTED_AT, sprendimoPriezastys: "Vienintelis pasiūlymas" },
        {
            daliesNumeris: "1",
            proceduruPabaiga: UNSUCCESSFUL,
            sprendimoPriemimoData: REPORTED_AT,
            sprendimoPriezastys: "Atsirado nenumatytų aplinkybių",
        },
    ],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};

// Two lots: one documented, one not — triggered. Unlike LT-OTH-05's
// "ALL lots must fail" formula, one lot's undocumented decision is not
// offset by another lot's well-documented one — see decision.ts.
export const twoLotsOneUndocumented: ProcurementProcedureOutcome = {
    lotOutcomes: [CONCLUDED, UNSUCCESSFUL],
    lots: [
        { daliesNumeris: "0", proceduruPabaiga: CONCLUDED, sprendimoPriemimoData: REPORTED_AT, sprendimoPriezastys: "Vienintelis pasiūlymas" },
        { daliesNumeris: "1", proceduruPabaiga: UNSUCCESSFUL, sprendimoPriemimoData: REPORTED_AT, sprendimoPriezastys: null },
    ],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
    courtChallenged: null,
    electronicProcurement: null,
};
