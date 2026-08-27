import type { ProcurementProcedureOutcome } from "../../../types.ts";

// Named procedure-outcome scenarios shared by decision.test.ts. A Subject's
// procedureOutcome comes from the Procurement Reader's own consolidated
// procurement-grain batch query (modules/risk/procurementReader.ts,
// public.v_pirkimo_pabaiga_v2) — these fixtures describe the expected
// Procurement.procedureOutcome shape directly. The query's own cross-lot
// aggregation correctness is tested once, in
// test/risk/procurementReader.it.ts.

export const REPORTED_AT = "2026-05-04";

// One lot, contract concluded — the plain not_triggered case. The exact
// label real data most commonly carries (see README.md's 2026-08
// measurement).
export const oneLotConcluded: ProcurementProcedureOutcome = {
    lotOutcomes: [
        "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
    ],
    lots: [
        {
            daliesNumeris: "0",
            proceduruPabaiga:
                "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
            sprendimoPriemimoData: REPORTED_AT,
            sprendimoPriezastys: null,
        },
    ],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
};

// One lot, no bids received within the deadline — the plain triggered case.
export const oneLotNoBids: ProcurementProcedureOutcome = {
    lotOutcomes: ["Per nustatytą terminą tiekėjams nepateikus nė vienos paraiškos, pasiūlymo, projekto konkurso plano ar projekto"],
    lots: [
        {
            daliesNumeris: "0",
            proceduruPabaiga: "Per nustatytą terminą tiekėjams nepateikus nė vienos paraiškos, pasiūlymo, projekto konkurso plano ar projekto",
            sprendimoPriemimoData: REPORTED_AT,
            sprendimoPriezastys: null,
        },
    ],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
};

// One lot, all submitted tenders rejected — another triggered case, distinct
// from "no bids at all".
export const oneLotAllRejected: ProcurementProcedureOutcome = {
    lotOutcomes: ["Atmetus visas paraiškas, pasiūlymus, projekto konkurso planus ar projektus"],
    lots: [
        {
            daliesNumeris: "0",
            proceduruPabaiga: "Atmetus visas paraiškas, pasiūlymus, projekto konkurso planus ar projektus",
            sprendimoPriemimoData: REPORTED_AT,
            sprendimoPriezastys: null,
        },
    ],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
};

// Two lots: one concluded, one not — not_triggered, since at least one lot
// of the procurement did end in a contract (the "ALL lots must fail"
// formula — see decision.ts/README.md).
export const mixedLotsOneConcluded: ProcurementProcedureOutcome = {
    lotOutcomes: [
        "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
        "Nutraukus pirkimo ar projekto konkurso procedūras",
    ],
    lots: [
        {
            daliesNumeris: "0",
            proceduruPabaiga:
                "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
            sprendimoPriemimoData: REPORTED_AT,
            sprendimoPriezastys: null,
        },
        { daliesNumeris: "1", proceduruPabaiga: "Nutraukus pirkimo ar projekto konkurso procedūras", sprendimoPriemimoData: REPORTED_AT, sprendimoPriezastys: null },
    ],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
};

// Two lots, both unsuccessful, different reasons — still triggered.
export const twoLotsBothUnsuccessful: ProcurementProcedureOutcome = {
    lotOutcomes: [
        "Nutraukus pirkimo ar projekto konkurso procedūras",
        "Atmetus visas paraiškas, pasiūlymus, projekto konkurso planus ar projektus",
    ],
    lots: [
        { daliesNumeris: "0", proceduruPabaiga: "Nutraukus pirkimo ar projekto konkurso procedūras", sprendimoPriemimoData: REPORTED_AT, sprendimoPriezastys: null },
        {
            daliesNumeris: "1",
            proceduruPabaiga: "Atmetus visas paraiškas, pasiūlymus, projekto konkurso planus ar projektus",
            sprendimoPriemimoData: REPORTED_AT,
            sprendimoPriezastys: null,
        },
    ],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
};

// The near-duplicate "concluded" phrasing real data also carries
// (capitalization/wording variants — see definition.ts's concludedOutcomes).
export const oneLotConcludedVariant: ProcurementProcedureOutcome = {
    lotOutcomes: ["Sudarius pirkimo sutartį (preliminariąją sutartį) arba nustačius projekto konkurso laimėtoją"],
    lots: [
        {
            daliesNumeris: "0",
            proceduruPabaiga: "Sudarius pirkimo sutartį (preliminariąją sutartį) arba nustačius projekto konkurso laimėtoją",
            sprendimoPriemimoData: REPORTED_AT,
            sprendimoPriezastys: null,
        },
    ],
    reportedAt: REPORTED_AT,
    isFramework: null,
    complaintFiled: null,
};
