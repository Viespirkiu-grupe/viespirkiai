import { describe, expect, it } from "vitest";
import { LtCom11Decision } from "../decision.ts";
import type { Bid, Lot, LotSubject, Procurement } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    disqualifiedBidStillCounted,
    exactDoublePrice,
    identicalPricesDoNotCount,
    invalidPricesIgnored,
    multipleBeyondCap,
    nearTripleOutsideTolerance,
    nearTriplePriceWithinTolerance,
    noFixedMultiple,
    noPricedBids,
    onePricedBid,
    REPORTED_AT,
    tightestMatchAmongSeveralPairs,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-11: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Bid scenarios
// come from fixtures.ts; procurementReader.it.ts proves the bid-grain query
// actually produces shapes like these.
//
// assessRisk() assumes isEligible() already passed — the "assessRisk"
// describe block calls it directly. The eligibility-gate and
// hasRequiredData cases belong to the "end to end" describe block, which
// goes through RiskDecisionEngine, since that is genuinely how a LotSubject
// reaches assessRisk in production.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01" });
const ltCom11v1 = new LtCom11Decision(CONTEXT);

function testProcurement(overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900001",
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
        subjektoRaktas: "cvpis:900001:0",
        saltinis: "cvpis",
        pirkimoNumeris: "900001",
        daliesNumeris: "0",
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

function lotSubject(bids: readonly Bid[], procurementOverrides: Partial<Procurement> = {}): LotSubject {
    const procurement = testProcurement(procurementOverrides);
    return {
        subjectType: "lot",
        subjectKey: "cvpis:900001:0",
        procurementSource: "cvpis",
        procurementId: "900001",
        procurement,
        lot: testLot(bids),
    };
}

function assessRiskFor(bids: readonly Bid[]) {
    return ltCom11v1.assessRisk(lotSubject(bids));
}

describe("LtCom11Decision.assessRisk", () => {
    it("triggers when one price is exactly double another", () => {
        const signal = assessRiskFor(exactDoublePrice);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({
            pricedBids: 3,
            matchedMultiple: 2,
            ratio: 2,
            lowerPrice: 1000,
            higherPrice: 2000,
        });
        expect(signal.threshold).toEqual({ minimumPricedBids: 2, maxMultiple: 5, relativeTolerance: 0.005 });
    });

    it("triggers when a ratio is within tolerance of an exact triple", () => {
        const signal = assessRiskFor(nearTriplePriceWithinTolerance);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toMatchObject({ matchedMultiple: 3, lowerPrice: 100, higherPrice: 300.4 });
    });

    it("does not trigger when a near-triple ratio falls outside tolerance", () => {
        const signal = assessRiskFor(nearTripleOutsideTolerance);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({
            pricedBids: 2,
            matchedMultiple: null,
            ratio: null,
            lowerPrice: null,
            higherPrice: null,
        });
    });

    it("does not trigger when no pair of priced bids forms a round multiple", () => {
        const signal = assessRiskFor(noFixedMultiple);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toMatchObject({ matchedMultiple: null });
    });

    it("does not treat identical prices (ratio 1) as a fixed multiple — that is LT-COM-10's concept", () => {
        const signal = assessRiskFor(identicalPricesDoNotCount);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toMatchObject({ matchedMultiple: null });
    });

    it("does not trigger when the only exact ratio exceeds maxMultiple", () => {
        const signal = assessRiskFor(multipleBeyondCap);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toMatchObject({ matchedMultiple: null });
    });

    it("reports the tightest match when more than one pair is compared", () => {
        const signal = assessRiskFor(tightestMatchAmongSeveralPairs);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toMatchObject({ matchedMultiple: 2, lowerPrice: 1000, higherPrice: 2001 });
    });

    it("counts a disqualified bid's price — the indicator judges submitted prices, not survivors", () => {
        const signal = assessRiskFor(disqualifiedBidStillCounted);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toMatchObject({ matchedMultiple: 2 });
    });

    it("does not trigger with only one usable priced bid — nothing to compare it against", () => {
        const signal = assessRiskFor(onePricedBid);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ pricedBids: 1 });
    });

    it("ignores negative/NaN parsing artefacts", () => {
        const signal = assessRiskFor(invalidPricesIgnored);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ pricedBids: 1 });
    });

    it("reports insufficient_data when bids were reported but none carry a usable price", () => {
        const signal = assessRiskFor(noPricedBids);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["pasiulymoKaina"]);
    });

    it("is total: every scenario returns one of the four states", () => {
        const scenarios = [
            exactDoublePrice,
            nearTriplePriceWithinTolerance,
            nearTripleOutsideTolerance,
            noFixedMultiple,
            identicalPricesDoNotCount,
            multipleBeyondCap,
            tightestMatchAmongSeveralPairs,
            disqualifiedBidStillCounted,
            onePricedBid,
            invalidPricesIgnored,
            noPricedBids,
            [],
        ];
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const bids of scenarios) {
            expect(states).toContain(assessRiskFor(bids).state);
        }
    });

    it("is pure: the same bids shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(exactDoublePrice)).toEqual(assessRiskFor(exactDoublePrice));
    });
});

describe("LtCom11Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltCom11v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying a merged-bids lot", () => {
        const procurement = testProcurement({ lots: [testLot(exactDoublePrice)] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({ indicatorId: "LT-COM-11", subjectType: "lot", state: "triggered" });
    });

    it("reports insufficient_data when no participation was observed for the lot", () => {
        const procurement = testProcurement({ lots: [testLot([])] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });

    it("reports the shared eligibility gate's signal for a non-cvpis procurement, without needing bids", () => {
        const procurement = testProcurement({ saltinis: "cvpp", pirkimoBudas: null, lots: [testLot([])] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("not_applicable");
    });
});
