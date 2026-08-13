import { describe, expect, it } from "vitest";
import { ltCom01Verdict, type LtCom01Facts } from "../calculate.ts";
import { ltCom01Parameters } from "../parameters.ts";
import {
    duplicateBidderRows,
    emptyReportFacts,
    oneOfTwoRejected,
    singleBidder,
    twoLotsDifferentOutcomes,
    twoValidBidders,
    unmatchedProcurement,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-01: plain objects in, plain
// objects out, no database and no clock (risk-service-architecture.md §11).
// The fact rows come from fixtures.ts, and calculate.it.ts proves collect.sql
// actually produces them.

const PARAMETERS = ltCom01Parameters[0].values;

function verdictFor(facts: LtCom01Facts) {
    return ltCom01Verdict(facts, PARAMETERS);
}

describe("ltCom01Verdict", () => {
    it("triggers when exactly one bidder submitted and it was not rejected", () => {
        const verdict = verdictFor(singleBidder.facts[0]);
        expect(verdict.state).toBe("triggered");
        expect(verdict.rawValue).toEqual({ totalBids: 1, validBids: 1 });
        expect(verdict.threshold).toEqual({ maximumValidBids: 1 });
    });

    it("triggers when one of two bidders was rejected, leaving one valid bid", () => {
        const verdict = verdictFor(oneOfTwoRejected.facts[0]);
        expect(verdict.state).toBe("triggered");
        expect(verdict.rawValue).toEqual({ totalBids: 2, validBids: 1 });
    });

    it("does not trigger when two bidders both remain valid", () => {
        const verdict = verdictFor(twoValidBidders.facts[0]);
        expect(verdict.state).toBe("not_triggered");
        expect(verdict.rawValue).toEqual({ totalBids: 2, validBids: 2 });
    });

    it("judges the exact threshold boundary", () => {
        const facts = twoValidBidders.facts[0];
        expect(ltCom01Verdict(facts, { maximumValidBids: 2 }).state).toBe("triggered");
        expect(ltCom01Verdict(facts, { maximumValidBids: 1 }).state).toBe("not_triggered");
    });

    it("judges each lot of a multi-lot procurement independently", () => {
        const [firstLot, secondLot] = twoLotsDifferentOutcomes.facts;
        expect(verdictFor(firstLot).state).toBe("triggered");
        expect(verdictFor(secondLot).state).toBe("not_triggered");
    });

    it("reports insufficient_data when the procurement source can't be resolved", () => {
        const verdict = verdictFor(unmatchedProcurement.facts[0]);
        expect(verdict.state).toBe("insufficient_data");
        expect(verdict.missingData).toEqual(["procurementSource"]);
        expect(verdict.rawValue).toBeUndefined();
        expect(verdict.threshold).toBeUndefined();
    });

    it("reports insufficient_data for a report that lists no participants", () => {
        const verdict = verdictFor(emptyReportFacts);
        expect(verdict.state).toBe("insufficient_data");
        expect(verdict.missingData).toEqual(["tiekejoKodas"]);
    });

    it("carries the report's own evidence on every state it returns", () => {
        for (const facts of [singleBidder.facts[0], twoValidBidders.facts[0], unmatchedProcurement.facts[0]]) {
            expect(verdictFor(facts).evidence).toEqual({
                pirkimoBudas: facts.method,
                ataskaitosData: facts.reportedAt,
                source: "ATN-1 ataskaita",
            });
        }
    });

    it("does not let duplicate source rows inflate the counts it judges", () => {
        // The de-duplication itself is collect.sql's job (calculate.it.ts);
        // this pins the verdict the de-duplicated row must produce.
        expect(verdictFor(duplicateBidderRows.facts[0]).state).toBe("triggered");
    });

    it("is total: every fact row returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const totalBids of [0, 1, 2, 7]) {
            for (const validBids of [0, 1, 2, 7]) {
                for (const procurementSource of ["cvpis", null]) {
                    const facts = { ...singleBidder.facts[0], totalBids, validBids, procurementSource };
                    expect(states).toContain(verdictFor(facts).state);
                }
            }
        }
    });

    it("is pure: the same fact row returns a deeply equal verdict every time", () => {
        const facts = oneOfTwoRejected.facts[0];
        expect(verdictFor(facts)).toEqual(verdictFor(facts));
    });
});
