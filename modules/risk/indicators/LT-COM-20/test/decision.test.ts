import { describe, expect, it } from "vitest";
import { LtCom20Decision } from "../decision.ts";
import type { Bid, BidSubject, Lot, Procurement } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import { noOutcomeBid, rankedBid, rankedThenWithdrawnBid, rejectedForCauseBid, withdrawnBid, WITHDRAWN_STATUS } from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-20: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture.md). Bid scenarios come
// from fixtures.ts; procurementReader.it.ts proves the bid-grain query
// itself produces them.
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly, the way
// RiskDecisionEngine does once eligibility is settled. The eligibility-gate
// and hasRequiredData cases belong to the "end to end" describe block, which
// goes through RiskDecisionEngine itself, since that is genuinely how a
// BidSubject reaches assessRisk in production.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01", subjects: null });
const ltCom20v1 = new LtCom20Decision(CONTEXT);

function testProcurement(overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900301",
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
        ...overrides,
    };
}

function testLot(bids: readonly Bid[]): Lot {
    return {
        subjektoRaktas: "cvpis:900301:1",
        saltinis: "cvpis",
        pirkimoNumeris: "900301",
        daliesNumeris: "1",
        daliesPavadinimas: null,
        deklaruota: false,
        stebeta: true,
        dalyviuSkaicius: null,
        kainuSkaicius: null,
        atmestuSkaicius: null,
        participation: null,
        bids,
    };
}

function bidSubject(bid: Bid, procurementOverrides: Partial<Procurement> = {}): BidSubject {
    const procurement = testProcurement(procurementOverrides);
    const lot = testLot([bid]);
    return {
        subjectType: "bid",
        subjectKey: `cvpis:900301:1:${bid.tiekejoKodas}`,
        procurementSource: "cvpis",
        procurementId: "900301",
        procurement,
        lot,
        bid,
    };
}

function assessRiskFor(bid: Bid) {
    return ltCom20v1.assessRisk(bidSubject(bid));
}

describe("LtCom20Decision.assessRisk", () => {
    it("triggers when the bid's structured status is a self-withdrawal", () => {
        const signal = assessRiskFor(withdrawnBid);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ atmetimoStatusas: WITHDRAWN_STATUS });
        expect(signal.threshold).toEqual({ withdrawalStatuses: [WITHDRAWN_STATUS] });
    });

    it("does not trigger for a bid that was ranked and never rejected", () => {
        const signal = assessRiskFor(rankedBid);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ atmetimoStatusas: null });
    });

    it("does not trigger for a bid rejected by the buyer for cause, not withdrawn — the boundary against a similar but distinct status", () => {
        const signal = assessRiskFor(rejectedForCauseBid);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ atmetimoStatusas: "Dalyvio pasiūlymas buvo atmestas" });
    });

    it("triggers on the structured status even when the same row also carries a ranking", () => {
        const signal = assessRiskFor(rankedThenWithdrawnBid);
        expect(signal.state).toBe("triggered");
    });

    it("is total: every known atmetimoStatusas value returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const bid of [withdrawnBid, rankedBid, rejectedForCauseBid, rankedThenWithdrawnBid]) {
            expect(states).toContain(assessRiskFor(bid).state);
        }
    });

    it("is pure: the same bid shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(withdrawnBid)).toEqual(assessRiskFor(withdrawnBid));
    });
});

describe("LtCom20Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltCom20v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying a lot with a withdrawn bid", () => {
        const procurement = testProcurement({ lots: [testLot([withdrawnBid])] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-COM-20",
            subjectType: "bid",
            subjectKey: "cvpis:900301:1:B1",
            state: "triggered",
        });
    });

    it("reports insufficient_data when the bid carries no ranking and no rejection outcome", () => {
        const procurement = testProcurement({ lots: [testLot([noOutcomeBid])] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["eileNumeris", "atmetimoStatusas"]);
    });

    it("reports the shared eligibility gate's signal for a non-cvpis procurement, without needing bid data", () => {
        const procurement = testProcurement({ saltinis: "cvpp", pirkimoBudas: null, lots: [testLot([withdrawnBid])] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("not_applicable");
    });

    it("emits one signal per bid when a lot has several bidders", () => {
        const procurement = testProcurement({ lots: [testLot([withdrawnBid, rankedBid, rejectedForCauseBid])] });
        const signals = engine.evaluateAll([procurement])[0].signals;
        expect(signals).toHaveLength(3);
        expect(signals.map((s) => s.state).sort()).toEqual(["not_triggered", "not_triggered", "triggered"]);
    });

    it("never evaluates a lot with no observed bids", () => {
        const procurement = testProcurement({ lots: [testLot([])] });
        const signals = engine.evaluateAll([procurement])[0].signals;
        expect(signals).toHaveLength(0);
    });
});
