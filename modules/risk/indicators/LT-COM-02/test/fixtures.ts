import type { LtCom02Facts } from "../rules.ts";

// Deterministic cases shared by both halves of the indicator's tests.
//
// Each fixture is a procurement shape *and* the fact rows collect.sql must
// produce from it. collect.it.ts asserts the SQL returns exactly `facts`;
// rules.test.ts feeds those same rows to ltCom02Decide. The two tests
// therefore meet on one value rather than on two independent guesses about
// what a fact row looks like (risk-service-architecture.md §8).
//
// Unlike LT-COM-01's fixtures, bidders here carry no validity flag: totalBids
// counts every distinct participant regardless of whether their bid was later
// rejected, so rejection status has no bearing on this indicator.

export type LotFixture = Readonly<{ daliesNumeris: string | null; bidders: readonly string[] }>;

export type ProcurementFixture = Readonly<{
    pirkimoId: number;
    pirkimoBudas: string;
    // false reproduces a real ingestion-lag gap: an ATN-1 report whose
    // pirkimoNumeris has no matching viesiejiPirkimai row yet.
    registerProcurement: boolean;
    // When the ATN-1 report was recorded, compared against the run cutoff.
    reportedAt: string;
    lots: readonly LotFixture[];
    facts: readonly LtCom02Facts[];
}>;

// Every fixture below is recorded well before this, so only lateReport and
// the later-cutoff check in collect.it.ts exercise the cutoff filter.
export const REPORTED_AT = "2026-05-04T09:30:00Z";

const METHOD = "Atviras konkursas";

// Two participants — below the minimumBidders: 3 default — the plain
// triggered case.
export const twoBidders: ProcurementFixture = {
    pirkimoId: 900101,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: ["B1", "B2"] }],
    facts: [
        {
            subjectKey: "cvpis:900101:0",
            procurementSource: "cvpis",
            procurementId: "900101",
            method: METHOD,
            totalBids: 2,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Exactly three participants — the boundary, just inside the threshold
// (minimumBidders: 3 does not trigger on totalBids === 3).
export const threeBidders: ProcurementFixture = {
    pirkimoId: 900102,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: ["B1", "B2", "B3"] }],
    facts: [
        {
            subjectKey: "cvpis:900102:0",
            procurementSource: "cvpis",
            procurementId: "900102",
            method: METHOD,
            totalBids: 3,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Five participants — the plain not_triggered case, well clear of the
// boundary.
export const fiveBidders: ProcurementFixture = {
    pirkimoId: 900103,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: ["B1", "B2", "B3", "B4", "B5"] }],
    facts: [
        {
            subjectKey: "cvpis:900103:0",
            procurementSource: "cvpis",
            procurementId: "900103",
            method: METHOD,
            totalBids: 5,
            reportedAt: REPORTED_AT,
        },
    ],
};

// An ATN-1 report with real participant data whose pirkimoNumeris never got a
// matching viesiejiPirkimai row — insufficient_data, because the procurement
// source can't be resolved.
export const unmatchedProcurement: ProcurementFixture = {
    pirkimoId: 900104,
    pirkimoBudas: METHOD,
    registerProcurement: false,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: ["B1"] }],
    facts: [
        {
            subjectKey: "unknown:900104:0",
            procurementSource: null,
            procurementId: "900104",
            method: METHOD,
            totalBids: 1,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Two lots in the same procurement with different outcomes — lots are
// evaluated independently.
export const twoLotsDifferentBidderCounts: ProcurementFixture = {
    pirkimoId: 900105,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [
        { daliesNumeris: "1", bidders: ["B1", "B2"] },
        { daliesNumeris: "2", bidders: ["B1", "B2", "B3", "B4", "B5"] },
    ],
    facts: [
        {
            subjectKey: "cvpis:900105:1",
            procurementSource: "cvpis",
            procurementId: "900105",
            method: METHOD,
            totalBids: 2,
            reportedAt: REPORTED_AT,
        },
        {
            subjectKey: "cvpis:900105:2",
            procurementSource: "cvpis",
            procurementId: "900105",
            method: METHOD,
            totalBids: 5,
            reportedAt: REPORTED_AT,
        },
    ],
};

// The same bidder listed twice for one lot — duplicate source rows must not
// inflate the count, which is what `count(DISTINCT ...)` is there for.
export const duplicateBidderRows: ProcurementFixture = {
    pirkimoId: 900106,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: ["B1", "B1"] }],
    facts: [
        {
            subjectKey: "cvpis:900106:0",
            procurementSource: "cvpis",
            procurementId: "900106",
            method: METHOD,
            totalBids: 1,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Recorded after the run cutoff — collect.sql must not see it at all.
export const lateReport: ProcurementFixture = {
    pirkimoId: 900107,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: "2026-09-01T00:00:00Z",
    lots: [{ daliesNumeris: null, bidders: ["B1"] }],
    facts: [],
};

// Recorded before the parameter timeline begins (2026-01-01), so a run at a
// cutoff in 2025 collects it but no reviewed threshold covers it.
export const reportedBeforeParameters: ProcurementFixture = {
    pirkimoId: 900108,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: "2025-11-02T08:00:00Z",
    lots: [{ daliesNumeris: null, bidders: ["B1"] }],
    facts: [
        {
            subjectKey: "cvpis:900108:0",
            procurementSource: "cvpis",
            procurementId: "900108",
            method: METHOD,
            totalBids: 1,
            reportedAt: "2025-11-02T08:00:00Z",
        },
    ],
};

// A fact row no fixture procurement produces: an ATN-1 report listing no
// participants at all. It cannot be built through the ingestion tables (a lot
// exists because a participant row exists), so it is a decision-only case.
export const emptyReportFacts: LtCom02Facts = {
    subjectKey: "cvpis:900109:0",
    procurementSource: "cvpis",
    procurementId: "900109",
    method: METHOD,
    totalBids: 0,
    reportedAt: REPORTED_AT,
};
