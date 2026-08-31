import { describe, expect, it } from "vitest";
import { LtPri09Decision } from "../decision.ts";
import type { Bid, BidSubject, Lot, Procurement } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    disqualifiedCheaperBidExcluded,
    exactlyAtTolerance,
    invalidCompetitorPriceIgnored,
    justUnderTolerance,
    noDiscount,
    noKnownWinner,
    noOtherValidBid,
    rankedButDisqualified,
    REPORTED_AT,
    winnerHeavilyDiscounted,
    winnerMissingPrice,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-PRI-09: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture.md). Bid scenarios come
// from fixtures.ts; procurementReader.it.ts proves the bid-grain query
// itself produces shapes like these.
//
// assessRisk() assumes isEligible() already passed — the "assessRisk"
// describe block calls it directly, against the winning bid picked out of
// each fixture's lot. The eligibility-gate cases (non-winner bids,
// no-known-winner lots) belong to the "end to end" describe block, which
// goes through RiskDecisionEngine, since that is genuinely how a BidSubject
// reaches assessRisk in production.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01" });
const ltPri09v1 = new LtPri09Decision(CONTEXT);

function testProcurement(overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900401",
        pavadinimas: null,
        jarKodas: null,
        pirkimoBudas: "Atviras konkursas",
        statusas: null,
        pirkimoObjektoTipas: null,
        numatomaVerteEUR: null,
        paskelbimoData: null,
        pasiulymuPateikimoTerminas: null,
        bvpzKodai: null,
        esFinansavimas: null,
        lots: [],
        participation: null,
        procedureOutcome: null,
        contractSignatureDates: null,
        ...overrides,
    };
}

function testLot(bids: readonly Bid[]): Lot {
    return {
        subjektoRaktas: "cvpis:900401:1",
        saltinis: "cvpis",
        pirkimoNumeris: "900401",
        daliesNumeris: "1",
        daliesPavadinimas: null,
        deklaruota: false,
        stebeta: true,
        dalyviuSkaicius: null,
        kainuSkaicius: null,
        atmestuSkaicius: null,
        participation: bids.length > 0 ? { totalBids: bids.length, validBids: 0, reportedAt: REPORTED_AT } : null,
        bids,
    };
}

function bidSubject(
    bids: readonly Bid[],
    theBid: Bid,
    procurementOverrides: Partial<Procurement> = {},
): BidSubject {
    const procurement = testProcurement(procurementOverrides);
    const lot = testLot(bids);
    return {
        subjectType: "bid",
        subjectKey: `cvpis:900401:1:${theBid.tiekejoKodas}`,
        procurementSource: "cvpis",
        procurementId: "900401",
        procurement,
        lot,
        bid: theBid,
    };
}

// The winner is the bid ranked #1 among the fixture's whole-lot array —
// the same subject the RiskDecisionEngine would build a BidSubject for.
function winnerOf(bids: readonly Bid[]): Bid {
    const winner = bids.find((b) => b.eileNumeris === 1);
    if (!winner) throw new Error("fixture has no eileNumeris === 1 bid");
    return winner;
}

function assessRiskForWinner(bids: readonly Bid[]) {
    return ltPri09v1.assessRisk(bidSubject(bids, winnerOf(bids)));
}

describe("LtPri09Decision.assessRisk", () => {
    it("triggers when the winner's price is far below the second-lowest valid bid", () => {
        const signal = assessRiskForWinner(winnerHeavilyDiscounted);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({
            validBids: 3,
            winningPrice: 1000,
            secondLowestValidPrice: 2500,
            relativeDiscount: 1.5,
        });
        expect(signal.threshold).toEqual({ minimumValidBids: 2, minRelativeDiscount: 1.0 });
    });

    it("triggers when the relative discount is exactly at the tolerance boundary", () => {
        const signal = assessRiskForWinner(exactlyAtTolerance);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toMatchObject({ relativeDiscount: 1.0, winningPrice: 1000, secondLowestValidPrice: 2000 });
    });

    it("does not trigger when the relative discount is just under the tolerance boundary", () => {
        const signal = assessRiskForWinner(justUnderTolerance);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toMatchObject({ relativeDiscount: 0.9995 });
    });

    it("does not trigger when the winner is priced close to the runner-up", () => {
        const signal = assessRiskForWinner(noDiscount);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toMatchObject({ winningPrice: 9000, secondLowestValidPrice: 10500 });
    });

    it("excludes a disqualified bid from the second-lowest-valid comparison, even if it is cheaper", () => {
        const signal = assessRiskForWinner(disqualifiedCheaperBidExcluded);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toMatchObject({ secondLowestValidPrice: 2500 });
    });

    it("does not trigger with no other valid priced bid — nothing to compare the winner against", () => {
        const signal = assessRiskForWinner(noOtherValidBid);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ validBids: 1 });
    });

    it("ignores negative/NaN parsing artefacts as competitor prices", () => {
        const signal = assessRiskForWinner(invalidCompetitorPriceIgnored);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ validBids: 1 });
    });

    it("is total: every scenario returns one of the four states", () => {
        const scenarios = [
            winnerHeavilyDiscounted,
            exactlyAtTolerance,
            justUnderTolerance,
            noDiscount,
            disqualifiedCheaperBidExcluded,
            noOtherValidBid,
            invalidCompetitorPriceIgnored,
        ];
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const bids of scenarios) {
            expect(states).toContain(assessRiskForWinner(bids).state);
        }
    });

    it("is pure: the same bids shape returns a deeply equal signal every time", () => {
        expect(assessRiskForWinner(winnerHeavilyDiscounted)).toEqual(assessRiskForWinner(winnerHeavilyDiscounted));
    });
});

describe("LtPri09Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltPri09v1], CONTEXT);

    it("flags the winning bid when it is heavily discounted", () => {
        const procurement = testProcurement({ lots: [testLot(winnerHeavilyDiscounted)] });
        const signals = engine.evaluateAll([procurement])[0].signals;
        const winnerSignal = signals.find((s) => s.subjectKey === "cvpis:900401:1:B1")!;
        expect(winnerSignal).toMatchObject({ indicatorId: "LT-PRI-09", subjectType: "bid", state: "triggered" });
    });

    it("marks every non-winning bid not_applicable", () => {
        const procurement = testProcurement({ lots: [testLot(winnerHeavilyDiscounted)] });
        const signals = engine.evaluateAll([procurement])[0].signals;
        const loserSignals = signals.filter((s) => s.subjectKey !== "cvpis:900401:1:B1");
        expect(loserSignals).toHaveLength(2);
        for (const signal of loserSignals) {
            expect(signal.state).toBe("not_applicable");
        }
    });

    it("marks every bid not_applicable when no bid is a known winner", () => {
        const procurement = testProcurement({ lots: [testLot(noKnownWinner)] });
        const signals = engine.evaluateAll([procurement])[0].signals;
        expect(signals).toHaveLength(2);
        for (const signal of signals) {
            expect(signal.state).toBe("not_applicable");
        }
    });

    it("does not treat a disqualified #1-ranked bid as the winner", () => {
        const procurement = testProcurement({ lots: [testLot(rankedButDisqualified)] });
        const signals = engine.evaluateAll([procurement])[0].signals;
        for (const signal of signals) {
            expect(signal.state).toBe("not_applicable");
        }
    });

    it("reports insufficient_data when the winner's own price is missing", () => {
        const procurement = testProcurement({ lots: [testLot(winnerMissingPrice)] });
        const signals = engine.evaluateAll([procurement])[0].signals;
        const winnerSignal = signals.find((s) => s.subjectKey === "cvpis:900401:1:B1")!;
        expect(winnerSignal.state).toBe("insufficient_data");
        expect(winnerSignal.missingData).toEqual(["pasiulymoKaina"]);
    });

    it("reports the shared eligibility gate's signal for a non-cvpis procurement, without needing bid data", () => {
        const procurement = testProcurement({
            saltinis: "cvpp",
            pirkimoBudas: null,
            lots: [testLot(winnerHeavilyDiscounted)],
        });
        const signals = engine.evaluateAll([procurement])[0].signals;
        for (const signal of signals) {
            expect(signal.state).toBe("not_applicable");
        }
    });

    it("never evaluates a lot with no observed bids", () => {
        const procurement = testProcurement({ lots: [testLot([])] });
        const signals = engine.evaluateAll([procurement])[0].signals;
        expect(signals).toHaveLength(0);
    });
});
