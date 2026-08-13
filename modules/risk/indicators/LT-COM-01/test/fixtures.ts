import type { LtCom01Facts } from "../calculate.ts";

// Deterministic cases shared by both halves of the indicator's tests.
//
// Each fixture is a procurement shape *and* the fact rows collect.sql must
// produce from it. calculate.it.ts asserts the SQL returns exactly `facts`;
// calculate.test.ts feeds those same rows to ltCom01Verdict. The two tests
// therefore meet on one value rather than on two independent guesses about
// what a fact row looks like (risk-service-architecture.md §11).

export type BidderFixture = Readonly<{ kodas: string; valid: boolean }>;
export type LotFixture = Readonly<{ daliesNumeris: string | null; bidders: readonly BidderFixture[] }>;

export type ProcurementFixture = Readonly<{
    pirkimoId: number;
    pirkimoBudas: string;
    // false reproduces a real ingestion-lag gap: an ATN-1 report whose
    // pirkimoNumeris has no matching viesiejiPirkimai row yet.
    registerProcurement: boolean;
    // When the ATN-1 report was recorded, compared against the run cutoff.
    reportedAt: string;
    lots: readonly LotFixture[];
    facts: readonly LtCom01Facts[];
}>;

// Every fixture below is recorded well before this, so only CUTOFF_BEFORE_REPORT
// and lateReport exercise the cutoff filter.
export const REPORTED_AT = "2026-05-04T09:30:00Z";

const METHOD = "Atviras konkursas";

// Exactly one bidder, not rejected — the plain triggered case.
export const singleBidder: ProcurementFixture = {
    pirkimoId: 900001,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: [{ kodas: "B1", valid: true }] }],
    facts: [
        {
            subjectKey: "cvpis:900001:0",
            procurementSource: "cvpis",
            procurementId: "900001",
            method: METHOD,
            totalBids: 1,
            validBids: 1,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Two bidders submitted, one was rejected — still triggered: exactly one bid
// survived evaluation.
export const oneOfTwoRejected: ProcurementFixture = {
    pirkimoId: 900002,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [
        {
            daliesNumeris: null,
            bidders: [
                { kodas: "B1", valid: true },
                { kodas: "B2", valid: false },
            ],
        },
    ],
    facts: [
        {
            subjectKey: "cvpis:900002:0",
            procurementSource: "cvpis",
            procurementId: "900002",
            method: METHOD,
            totalBids: 2,
            validBids: 1,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Two bidders, neither rejected — not_triggered.
export const twoValidBidders: ProcurementFixture = {
    pirkimoId: 900003,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [
        {
            daliesNumeris: null,
            bidders: [
                { kodas: "B1", valid: true },
                { kodas: "B2", valid: true },
            ],
        },
    ],
    facts: [
        {
            subjectKey: "cvpis:900003:0",
            procurementSource: "cvpis",
            procurementId: "900003",
            method: METHOD,
            totalBids: 2,
            validBids: 2,
            reportedAt: REPORTED_AT,
        },
    ],
};

// An ATN-1 report with real participant data whose pirkimoNumeris never got a
// matching viesiejiPirkimai row — insufficient_data, because the procurement
// source can't be resolved.
export const unmatchedProcurement: ProcurementFixture = {
    pirkimoId: 900004,
    pirkimoBudas: METHOD,
    registerProcurement: false,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: [{ kodas: "B1", valid: true }] }],
    facts: [
        {
            subjectKey: "unknown:900004:0",
            procurementSource: null,
            procurementId: "900004",
            method: METHOD,
            totalBids: 1,
            validBids: 1,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Two lots in the same procurement with different outcomes — lots are
// evaluated independently.
export const twoLotsDifferentOutcomes: ProcurementFixture = {
    pirkimoId: 900005,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [
        { daliesNumeris: "1", bidders: [{ kodas: "B1", valid: true }] },
        {
            daliesNumeris: "2",
            bidders: [
                { kodas: "B1", valid: true },
                { kodas: "B2", valid: true },
            ],
        },
    ],
    facts: [
        {
            subjectKey: "cvpis:900005:1",
            procurementSource: "cvpis",
            procurementId: "900005",
            method: METHOD,
            totalBids: 1,
            validBids: 1,
            reportedAt: REPORTED_AT,
        },
        {
            subjectKey: "cvpis:900005:2",
            procurementSource: "cvpis",
            procurementId: "900005",
            method: METHOD,
            totalBids: 2,
            validBids: 2,
            reportedAt: REPORTED_AT,
        },
    ],
};

// The same bidder listed twice for one lot — duplicate source rows must not
// inflate the counts, which is what `count(DISTINCT ...)` is there for.
export const duplicateBidderRows: ProcurementFixture = {
    pirkimoId: 900006,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [
        {
            daliesNumeris: null,
            bidders: [
                { kodas: "B1", valid: true },
                { kodas: "B1", valid: true },
            ],
        },
    ],
    facts: [
        {
            subjectKey: "cvpis:900006:0",
            procurementSource: "cvpis",
            procurementId: "900006",
            method: METHOD,
            totalBids: 1,
            validBids: 1,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Recorded after the run cutoff — collect.sql must not see it at all.
export const lateReport: ProcurementFixture = {
    pirkimoId: 900007,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: "2026-09-01T00:00:00Z",
    lots: [{ daliesNumeris: null, bidders: [{ kodas: "B1", valid: true }] }],
    facts: [],
};

// Recorded before the parameter timeline begins (2026-01-01), so a run at a
// cutoff in 2025 collects it but no reviewed threshold covers it.
export const reportedBeforeParameters: ProcurementFixture = {
    pirkimoId: 900008,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: "2025-11-02T08:00:00Z",
    lots: [{ daliesNumeris: null, bidders: [{ kodas: "B1", valid: true }] }],
    facts: [
        {
            subjectKey: "cvpis:900008:0",
            procurementSource: "cvpis",
            procurementId: "900008",
            method: METHOD,
            totalBids: 1,
            validBids: 1,
            reportedAt: "2025-11-02T08:00:00Z",
        },
    ],
};

// A fact row no fixture procurement produces: an ATN-1 report listing no
// participants at all. It cannot be built through the ingestion tables (a lot
// exists because a participant row exists), so it is a verdict-only case.
export const emptyReportFacts: LtCom01Facts = {
    subjectKey: "cvpis:900009:0",
    procurementSource: "cvpis",
    procurementId: "900009",
    method: METHOD,
    totalBids: 0,
    validBids: 0,
    reportedAt: REPORTED_AT,
};
