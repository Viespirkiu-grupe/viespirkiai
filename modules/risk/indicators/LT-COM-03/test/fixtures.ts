import type { LtCom03Facts } from "../rules.ts";

// Deterministic cases shared by both halves of the indicator's tests.
//
// Each fixture is a procurement shape *and* the fact row collect.sql must
// produce from it. collect.it.ts asserts the SQL returns exactly `facts`;
// rules.test.ts feeds those same rows to ltCom03Decide. The two tests
// therefore meet on one value rather than on two independent guesses about
// what a fact row looks like (risk-service-architecture.md §8).
//
// Unlike LT-COM-01/LT-COM-02, the unit of analysis here is the whole
// procurement, not one lot: every lot's ATN-1 report rolls up into a single
// fact row, and totalSuppliers is the count of distinct suppliers recorded
// anywhere in the procurement. Rejection status has no bearing on this
// indicator, so bidders carry no validity flag.

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
    facts: readonly LtCom03Facts[];
}>;

// Every fixture below is recorded well before this, so only lateReport and
// the later-cutoff check in collect.it.ts exercise the cutoff filter.
export const REPORTED_AT = "2026-05-04T09:30:00Z";

const METHOD = "Atviras konkursas";

// Exactly one distinct supplier across the whole procurement — below the
// minimumSuppliers: 2 default — the plain triggered case.
export const oneSupplier: ProcurementFixture = {
    pirkimoId: 900201,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: ["B1"] }],
    facts: [
        {
            subjectKey: "cvpis:900201",
            procurementSource: "cvpis",
            procurementId: "900201",
            method: METHOD,
            totalSuppliers: 1,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Exactly two distinct suppliers — the boundary, just outside the threshold
// (minimumSuppliers: 2 does not trigger on totalSuppliers === 2).
export const twoSuppliers: ProcurementFixture = {
    pirkimoId: 900202,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: ["B1", "B2"] }],
    facts: [
        {
            subjectKey: "cvpis:900202",
            procurementSource: "cvpis",
            procurementId: "900202",
            method: METHOD,
            totalSuppliers: 2,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Five distinct suppliers — the plain not_triggered case, well clear of the
// boundary.
export const fiveSuppliers: ProcurementFixture = {
    pirkimoId: 900203,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: ["B1", "B2", "B3", "B4", "B5"] }],
    facts: [
        {
            subjectKey: "cvpis:900203",
            procurementSource: "cvpis",
            procurementId: "900203",
            method: METHOD,
            totalSuppliers: 5,
            reportedAt: REPORTED_AT,
        },
    ],
};

// An ATN-1 report with real participant data whose pirkimoNumeris never got a
// matching viesiejiPirkimai row — insufficient_data, because the procurement
// source can't be resolved.
export const unmatchedProcurement: ProcurementFixture = {
    pirkimoId: 900204,
    pirkimoBudas: METHOD,
    registerProcurement: false,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: ["B1"] }],
    facts: [
        {
            subjectKey: "unknown:900204",
            procurementSource: null,
            procurementId: "900204",
            method: METHOD,
            totalSuppliers: 1,
            reportedAt: REPORTED_AT,
        },
    ],
};

// The same supplier listed in two different lots of one procurement — the
// union across the whole procurement is what matters, so it is still counted
// once: this is the key structural difference from LT-COM-01/LT-COM-02, which
// judge each lot separately.
export const sameSupplierAcrossTwoLots: ProcurementFixture = {
    pirkimoId: 900205,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [
        { daliesNumeris: "1", bidders: ["B1"] },
        { daliesNumeris: "2", bidders: ["B1"] },
    ],
    facts: [
        {
            subjectKey: "cvpis:900205",
            procurementSource: "cvpis",
            procurementId: "900205",
            method: METHOD,
            totalSuppliers: 1,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Two lots with different suppliers, neither lot alone reaching two — proves
// the state is decided by the union across the procurement, not by either
// lot's own count.
export const differentSuppliersAcrossTwoLots: ProcurementFixture = {
    pirkimoId: 900206,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [
        { daliesNumeris: "1", bidders: ["B1"] },
        { daliesNumeris: "2", bidders: ["B2"] },
    ],
    facts: [
        {
            subjectKey: "cvpis:900206",
            procurementSource: "cvpis",
            procurementId: "900206",
            method: METHOD,
            totalSuppliers: 2,
            reportedAt: REPORTED_AT,
        },
    ],
};

// The same bidder listed twice for one lot — duplicate source rows must not
// inflate the count, which is what `count(DISTINCT ...)` is there for.
export const duplicateSupplierRows: ProcurementFixture = {
    pirkimoId: 900207,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: REPORTED_AT,
    lots: [{ daliesNumeris: null, bidders: ["B1", "B1"] }],
    facts: [
        {
            subjectKey: "cvpis:900207",
            procurementSource: "cvpis",
            procurementId: "900207",
            method: METHOD,
            totalSuppliers: 1,
            reportedAt: REPORTED_AT,
        },
    ],
};

// Recorded after the run cutoff — collect.sql must not see it at all.
export const lateReport: ProcurementFixture = {
    pirkimoId: 900208,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: "2026-09-01T00:00:00Z",
    lots: [{ daliesNumeris: null, bidders: ["B1"] }],
    facts: [],
};

// Recorded before the parameter timeline begins (2026-01-01), so a run at a
// cutoff in 2025 collects it but no reviewed threshold covers it.
export const reportedBeforeParameters: ProcurementFixture = {
    pirkimoId: 900209,
    pirkimoBudas: METHOD,
    registerProcurement: true,
    reportedAt: "2025-11-02T08:00:00Z",
    lots: [{ daliesNumeris: null, bidders: ["B1"] }],
    facts: [
        {
            subjectKey: "cvpis:900209",
            procurementSource: "cvpis",
            procurementId: "900209",
            method: METHOD,
            totalSuppliers: 1,
            reportedAt: "2025-11-02T08:00:00Z",
        },
    ],
};

// A fact row no fixture procurement produces: an ATN-1 report listing no
// participants at all. It cannot be built through the ingestion tables (a lot
// exists because a participant row exists), so it is a decision-only case.
export const emptyReportFacts: LtCom03Facts = {
    subjectKey: "cvpis:900210",
    procurementSource: "cvpis",
    procurementId: "900210",
    method: METHOD,
    totalSuppliers: 0,
    reportedAt: REPORTED_AT,
};
