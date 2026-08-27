import { describe, expect, it } from "vitest";
import { LtAwd03Decision } from "../decision.ts";
import type { Bid, Lot, LotSubject, Procurement } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    disqualifiedWithNoBasis,
    disqualifiedWithSpecificBasis,
    disqualifiedWithWeakBasis,
    mixedDisqualifications,
    noneDisqualified,
    REPORTED_AT,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-AWD-03: plain objects in, plain
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
const ltAwd03v1 = new LtAwd03Decision(CONTEXT);

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
    return ltAwd03v1.assessRisk(lotSubject(bids));
}

describe("LtAwd03Decision.assessRisk", () => {
    it("does not trigger when nothing was disqualified", () => {
        const signal = assessRiskFor(noneDisqualified);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ disqualifiedBids: 0, poorlySupportedBids: 0 });
    });

    it("does not trigger when the disqualification cites a specific statutory legal basis", () => {
        const signal = assessRiskFor(disqualifiedWithSpecificBasis);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ disqualifiedBids: 1, poorlySupportedBids: 0 });
    });

    it("triggers when the disqualification carries no legal basis at all", () => {
        const signal = assessRiskFor(disqualifiedWithNoBasis);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ disqualifiedBids: 1, poorlySupportedBids: 1 });
    });

    it("triggers when the disqualification's legal basis is the generic 'Kita' catch-all", () => {
        const signal = assessRiskFor(disqualifiedWithWeakBasis);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ disqualifiedBids: 1, poorlySupportedBids: 1 });
    });

    it("triggers on a single poorly-supported disqualification even alongside a well-supported one", () => {
        const signal = assessRiskFor(mixedDisqualifications);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ disqualifiedBids: 2, poorlySupportedBids: 1 });
    });

    it("reports insufficient_data when the lot reports no per-bid rows at all", () => {
        const signal = assessRiskFor([]);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["atmetimoPriezastis"]);
    });

    it("is total: every scenario returns one of the four states", () => {
        const scenarios = [
            noneDisqualified,
            disqualifiedWithSpecificBasis,
            disqualifiedWithNoBasis,
            disqualifiedWithWeakBasis,
            mixedDisqualifications,
            [],
        ];
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const bids of scenarios) {
            expect(states).toContain(assessRiskFor(bids).state);
        }
    });

    it("is pure: the same bids shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(mixedDisqualifications)).toEqual(assessRiskFor(mixedDisqualifications));
    });
});

describe("LtAwd03Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltAwd03v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying a merged-bids lot", () => {
        const procurement = testProcurement({ lots: [testLot(disqualifiedWithNoBasis)] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({ indicatorId: "LT-AWD-03", subjectType: "lot", state: "triggered" });
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
