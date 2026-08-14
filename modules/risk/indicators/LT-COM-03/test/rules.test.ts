import { describe, expect, it } from "vitest";
import { ltCom03Decide, type LtCom03Facts } from "../rules.ts";
import { ltCom03Parameters } from "../parameters.ts";
import {
    differentSuppliersAcrossTwoLots,
    duplicateSupplierRows,
    emptyReportFacts,
    fiveSuppliers,
    oneSupplier,
    sameSupplierAcrossTwoLots,
    twoSuppliers,
    unmatchedProcurement,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-03: plain objects in, plain
// objects out, no database and no clock (risk-service-architecture.md §8).
// The fact rows come from fixtures.ts, and collect.it.ts proves collect.sql
// actually produces them.

const PARAMETERS = ltCom03Parameters[0].values;

function decisionFor(facts: LtCom03Facts) {
    return ltCom03Decide(facts, PARAMETERS);
}

describe("ltCom03Decide", () => {
    it("triggers when only one supplier is recorded for the whole procurement", () => {
        const decision = decisionFor(oneSupplier.facts[0]);
        expect(decision.state).toBe("triggered");
        expect(decision.rawValue).toEqual({ totalSuppliers: 1 });
        expect(decision.threshold).toEqual({ minimumSuppliers: 2 });
    });

    it("does not trigger at exactly the minimum number of suppliers", () => {
        const decision = decisionFor(twoSuppliers.facts[0]);
        expect(decision.state).toBe("not_triggered");
        expect(decision.rawValue).toEqual({ totalSuppliers: 2 });
    });

    it("does not trigger with plenty of suppliers", () => {
        const decision = decisionFor(fiveSuppliers.facts[0]);
        expect(decision.state).toBe("not_triggered");
        expect(decision.rawValue).toEqual({ totalSuppliers: 5 });
    });

    it("judges the exact threshold boundary", () => {
        const facts = twoSuppliers.facts[0];
        expect(ltCom03Decide(facts, { minimumSuppliers: 2 }).state).toBe("not_triggered");
        expect(ltCom03Decide(facts, { minimumSuppliers: 3 }).state).toBe("triggered");
    });

    it("counts the same supplier once when it appears in two lots of one procurement", () => {
        const decision = decisionFor(sameSupplierAcrossTwoLots.facts[0]);
        expect(decision.state).toBe("triggered");
        expect(decision.rawValue).toEqual({ totalSuppliers: 1 });
    });

    it("decides from the union across every lot, not from either lot alone", () => {
        const decision = decisionFor(differentSuppliersAcrossTwoLots.facts[0]);
        expect(decision.state).toBe("not_triggered");
        expect(decision.rawValue).toEqual({ totalSuppliers: 2 });
    });

    it("reports insufficient_data when the procurement source can't be resolved", () => {
        const decision = decisionFor(unmatchedProcurement.facts[0]);
        expect(decision.state).toBe("insufficient_data");
        expect(decision.missingData).toEqual(["procurementSource"]);
        expect(decision.rawValue).toBeUndefined();
        expect(decision.threshold).toBeUndefined();
    });

    it("reports insufficient_data for a report that lists no participants", () => {
        const decision = decisionFor(emptyReportFacts);
        expect(decision.state).toBe("insufficient_data");
        expect(decision.missingData).toEqual(["tiekejoKodas"]);
    });

    it("carries the report's own evidence on every state it returns", () => {
        for (const facts of [oneSupplier.facts[0], fiveSuppliers.facts[0], unmatchedProcurement.facts[0]]) {
            expect(decisionFor(facts).evidence).toEqual({
                pirkimoBudas: facts.method,
                ataskaitosData: facts.reportedAt,
                source: "ATN-1 ataskaita",
            });
        }
    });

    it("does not let duplicate source rows inflate the count it judges", () => {
        // The de-duplication itself is collect.sql's job (collect.it.ts);
        // this pins the decision the de-duplicated row must produce.
        expect(decisionFor(duplicateSupplierRows.facts[0]).state).toBe("triggered");
    });

    it("is total: every fact row returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const totalSuppliers of [0, 1, 2, 3, 7]) {
            for (const procurementSource of ["cvpis", null]) {
                const facts = { ...oneSupplier.facts[0], totalSuppliers, procurementSource };
                expect(states).toContain(decisionFor(facts).state);
            }
        }
    });

    it("is pure: the same fact row returns a deeply equal decision every time", () => {
        const facts = differentSuppliersAcrossTwoLots.facts[0];
        expect(decisionFor(facts)).toEqual(decisionFor(facts));
    });
});
