import { describe, expect, it } from "vitest";
import { LtCom02Decision, type LtCom02Facts } from "../decision.ts";
import { ltCom02Parameters } from "../parameters.ts";
import {
    duplicateBidderRows,
    emptyReportFacts,
    fiveBidders,
    threeBidders,
    twoBidders,
    twoLotsDifferentBidderCounts,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-02: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). The fact rows
// come from fixtures.ts, and collect.it.ts proves collect.sql actually
// produces them. The procurementSource === null → insufficient_data case
// moved to modules/risk/procurementEligibility.test.ts and
// collect.it.ts's "end to end" describe block — the shared eligibility gate
// decides that now, before LtCom02Decision.decide ever runs.

const PARAMETERS = ltCom02Parameters[0].values;

function decisionFor(facts: LtCom02Facts) {
    return LtCom02Decision.decide(facts, PARAMETERS);
}

describe("LtCom02Decision.decide", () => {
    it("triggers when only two participants are recorded", () => {
        const decision = decisionFor(twoBidders.facts[0]);
        expect(decision.state).toBe("triggered");
        expect(decision.rawValue).toEqual({ totalBids: 2 });
        expect(decision.threshold).toEqual({ minimumBidders: 3 });
    });

    it("does not trigger at exactly the minimum number of bidders", () => {
        const decision = decisionFor(threeBidders.facts[0]);
        expect(decision.state).toBe("not_triggered");
        expect(decision.rawValue).toEqual({ totalBids: 3 });
    });

    it("does not trigger with plenty of participants", () => {
        const decision = decisionFor(fiveBidders.facts[0]);
        expect(decision.state).toBe("not_triggered");
        expect(decision.rawValue).toEqual({ totalBids: 5 });
    });

    it("judges the exact threshold boundary", () => {
        const facts = threeBidders.facts[0];
        expect(LtCom02Decision.decide(facts, { minimumBidders: 3 }).state).toBe("not_triggered");
        expect(LtCom02Decision.decide(facts, { minimumBidders: 4 }).state).toBe("triggered");
    });

    it("judges each lot of a multi-lot procurement independently", () => {
        const [firstLot, secondLot] = twoLotsDifferentBidderCounts.facts;
        expect(decisionFor(firstLot).state).toBe("triggered");
        expect(decisionFor(secondLot).state).toBe("not_triggered");
    });

    it("reports insufficient_data for a report that lists no participants", () => {
        const decision = decisionFor(emptyReportFacts);
        expect(decision.state).toBe("insufficient_data");
        expect(decision.missingData).toEqual(["tiekejoKodas"]);
    });

    it("carries the report's own evidence on every state it returns", () => {
        for (const facts of [twoBidders.facts[0], fiveBidders.facts[0], threeBidders.facts[0]]) {
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
        expect(decisionFor(duplicateBidderRows.facts[0]).state).toBe("triggered");
    });

    it("is total: every fact row returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const totalBids of [0, 1, 2, 3, 7]) {
            const facts = { ...twoBidders.facts[0], totalBids };
            expect(states).toContain(decisionFor(facts).state);
        }
    });

    it("is pure: the same fact row returns a deeply equal decision every time", () => {
        const facts = twoLotsDifferentBidderCounts.facts[0];
        expect(decisionFor(facts)).toEqual(decisionFor(facts));
    });
});
