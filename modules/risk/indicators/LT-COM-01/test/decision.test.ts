import { describe, expect, it } from "vitest";
import { LtCom01Decision, type LtCom01Facts } from "../decision.ts";
import { ltCom01Parameters } from "../parameters.ts";
import {
    duplicateBidderRows,
    emptyReportFacts,
    oneOfTwoRejected,
    singleBidder,
    twoLotsDifferentOutcomes,
    twoValidBidders,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-01: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). The fact rows
// come from fixtures.ts, and collect.it.ts proves collect.sql actually
// produces them. The procurementSource === null → insufficient_data case
// moved to modules/risk/procurementEligibility.test.ts and
// collect.it.ts's "end to end" describe block — the shared eligibility gate
// decides that now, before LtCom01Decision.decide ever runs.

const PARAMETERS = ltCom01Parameters[0].values;

function decisionFor(facts: LtCom01Facts) {
    return LtCom01Decision.decide(facts, PARAMETERS);
}

describe("LtCom01Decision.decide", () => {
    it("triggers when exactly one bidder submitted and it was not rejected", () => {
        const decision = decisionFor(singleBidder.facts[0]);
        expect(decision.state).toBe("triggered");
        expect(decision.rawValue).toEqual({ totalBids: 1, validBids: 1 });
        expect(decision.threshold).toEqual({ maximumValidBids: 1 });
    });

    it("triggers when one of two bidders was rejected, leaving one valid bid", () => {
        const decision = decisionFor(oneOfTwoRejected.facts[0]);
        expect(decision.state).toBe("triggered");
        expect(decision.rawValue).toEqual({ totalBids: 2, validBids: 1 });
    });

    it("does not trigger when two bidders both remain valid", () => {
        const decision = decisionFor(twoValidBidders.facts[0]);
        expect(decision.state).toBe("not_triggered");
        expect(decision.rawValue).toEqual({ totalBids: 2, validBids: 2 });
    });

    it("judges the exact threshold boundary", () => {
        const facts = twoValidBidders.facts[0];
        expect(LtCom01Decision.decide(facts, { maximumValidBids: 2 }).state).toBe("triggered");
        expect(LtCom01Decision.decide(facts, { maximumValidBids: 1 }).state).toBe("not_triggered");
    });

    it("judges each lot of a multi-lot procurement independently", () => {
        const [firstLot, secondLot] = twoLotsDifferentOutcomes.facts;
        expect(decisionFor(firstLot).state).toBe("triggered");
        expect(decisionFor(secondLot).state).toBe("not_triggered");
    });

    it("reports insufficient_data for a report that lists no participants", () => {
        const decision = decisionFor(emptyReportFacts);
        expect(decision.state).toBe("insufficient_data");
        expect(decision.missingData).toEqual(["tiekejoKodas"]);
    });

    it("carries the report's own evidence on every state it returns", () => {
        for (const facts of [singleBidder.facts[0], twoValidBidders.facts[0], oneOfTwoRejected.facts[0]]) {
            expect(decisionFor(facts).evidence).toEqual({
                pirkimoBudas: facts.method,
                ataskaitosData: facts.reportedAt,
                source: "ATN-1 ataskaita",
            });
        }
    });

    it("does not let duplicate source rows inflate the counts it judges", () => {
        // The de-duplication itself is collect.sql's job (collect.it.ts);
        // this pins the decision the de-duplicated row must produce.
        expect(decisionFor(duplicateBidderRows.facts[0]).state).toBe("triggered");
    });

    it("is total: every fact row returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const totalBids of [0, 1, 2, 7]) {
            for (const validBids of [0, 1, 2, 7]) {
                const facts = { ...singleBidder.facts[0], totalBids, validBids };
                expect(states).toContain(decisionFor(facts).state);
            }
        }
    });

    it("is pure: the same fact row returns a deeply equal decision every time", () => {
        const facts = oneOfTwoRejected.facts[0];
        expect(decisionFor(facts)).toEqual(decisionFor(facts));
    });
});
