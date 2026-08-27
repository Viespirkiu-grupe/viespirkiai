import { describe, expect, it } from "vitest";
import { LtAwd02Decision } from "../decision.ts";
import type { Bid, Lot, LotSubject, Procurement } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    allDisqualified,
    higherPriceDisqualified,
    invalidPriceIgnored,
    lowestDisqualified,
    noneDisqualified,
    noPricedBids,
    onePricedBid,
    REPORTED_AT,
    tiedLowestBothDisqualified,
    tiedLowestOneSurvives,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-AWD-02: plain objects in, plain
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

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01", subjects: null });
const ltAwd02v1 = new LtAwd02Decision(CONTEXT);

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
    return ltAwd02v1.assessRisk(lotSubject(bids));
}

describe("LtAwd02Decision.assessRisk", () => {
    it("triggers when the lowest-priced bid was disqualified and a pricier bid survives", () => {
        const signal = assessRiskFor(lowestDisqualified);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({
            pricedBids: 2,
            lowestPrice: 9000,
            lowestBidDisqualified: true,
            higherValidBidExists: true,
        });
        expect(signal.threshold).toEqual({ minimumPricedBids: 2 });
    });

    it("triggers when both bids tied at the lowest price were disqualified", () => {
        const signal = assessRiskFor(tiedLowestBothDisqualified);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toMatchObject({ lowestPrice: 9000, lowestBidDisqualified: true });
    });

    it("does not trigger when nothing was disqualified", () => {
        const signal = assessRiskFor(noneDisqualified);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toMatchObject({ lowestBidDisqualified: false });
    });

    it("does not trigger when a higher-priced bid, not the lowest, was disqualified", () => {
        const signal = assessRiskFor(higherPriceDisqualified);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toMatchObject({ lowestPrice: 9000, lowestBidDisqualified: false });
    });

    it("does not trigger when every priced bid was disqualified — no pricier survivor to except", () => {
        const signal = assessRiskFor(allDisqualified);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toMatchObject({ lowestBidDisqualified: true, higherValidBidExists: false });
    });

    it("does not trigger when one of two tied-lowest bids survives — the lowest price was not shut out", () => {
        const signal = assessRiskFor(tiedLowestOneSurvives);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toMatchObject({ lowestBidDisqualified: false });
    });

    it("does not trigger with only one usable priced bid — nothing to compare it against", () => {
        const signal = assessRiskFor(onePricedBid);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ pricedBids: 1 });
    });

    it("ignores a negative-price parsing artefact and does not trigger on it", () => {
        const signal = assessRiskFor(invalidPriceIgnored);
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
            lowestDisqualified,
            noneDisqualified,
            higherPriceDisqualified,
            allDisqualified,
            tiedLowestOneSurvives,
            tiedLowestBothDisqualified,
            onePricedBid,
            invalidPriceIgnored,
            noPricedBids,
            [],
        ];
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const bids of scenarios) {
            expect(states).toContain(assessRiskFor(bids).state);
        }
    });

    it("is pure: the same bids shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(lowestDisqualified)).toEqual(assessRiskFor(lowestDisqualified));
    });
});

describe("LtAwd02Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltAwd02v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying a merged-bids lot", () => {
        const procurement = testProcurement({ lots: [testLot(lowestDisqualified)] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({ indicatorId: "LT-AWD-02", subjectType: "lot", state: "triggered" });
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
