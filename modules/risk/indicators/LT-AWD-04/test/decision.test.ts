import { describe, expect, it } from "vitest";
import { LtAwd04Decision } from "../decision.ts";
import type { Lot, LotParticipation, LotSubject, Procurement } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    emptyReport,
    fourBiddersHalfSurvive,
    fourBiddersOneSurvivor,
    fourBiddersThreeSurvive,
    REPORTED_AT,
    twoBiddersOneSurvivor,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-AWD-04: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Participation
// scenarios come from fixtures.ts; procurementReader.it.ts proves the
// consolidated participation query actually produces them.
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly. The
// eligibility-gate and hasRequiredData cases belong to the "end to end"
// describe block, which goes through RiskDecisionEngine itself.

const CONTEXT = new EvaluationContext({ dataAsOf: "2026-08-01" });
const ltAwd04v1 = new LtAwd04Decision(CONTEXT);

function testProcurement(overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900101",
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

function testLot(participation: LotParticipation | null): Lot {
    return {
        subjektoRaktas: "cvpis:900101:0",
        saltinis: "cvpis",
        pirkimoNumeris: "900101",
        daliesNumeris: "0",
        daliesPavadinimas: null,
        deklaruota: false,
        stebeta: true,
        dalyviuSkaicius: null,
        kainuSkaicius: null,
        atmestuSkaicius: null,
        participation,
        bids: [],
    };
}

function lotSubject(participation: LotParticipation, procurementOverrides: Partial<Procurement> = {}): LotSubject {
    const procurement = testProcurement(procurementOverrides);
    return {
        subjectType: "lot",
        subjectKey: "cvpis:900101:0",
        procurementSource: "cvpis",
        procurementId: "900101",
        procurement,
        lot: testLot(participation),
    };
}

function assessRiskFor(participation: LotParticipation) {
    return ltAwd04v1.assessRisk(lotSubject(participation));
}

describe("LtAwd04Decision.assessRisk", () => {
    it("triggers when a strong majority of bids are disqualified (75%, minimumTotalBids met)", () => {
        const signal = assessRiskFor(fourBiddersOneSurvivor);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ totalBids: 4, disqualifiedShare: 0.75 });
        expect(signal.threshold).toEqual({ minimumTotalBids: 3, disqualifiedShareThreshold: 0.5 });
    });

    it("triggers at exactly the boundary — disqualifiedShareThreshold: 0.5 is inclusive", () => {
        const signal = assessRiskFor(fourBiddersHalfSurvive);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ totalBids: 4, disqualifiedShare: 0.5 });
    });

    it("does not trigger just inside the threshold (25% disqualified)", () => {
        const signal = assessRiskFor(fourBiddersThreeSurvive);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ totalBids: 4, disqualifiedShare: 0.25 });
    });

    it("does not trigger below minimumTotalBids even at a 50% disqualified share", () => {
        const signal = assessRiskFor(twoBiddersOneSurvivor);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ totalBids: 2, disqualifiedShare: 0.5 });
    });

    it("reports insufficient_data for a report that lists no participants", () => {
        const signal = assessRiskFor(emptyReport);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });

    it("is total: every participation shape returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const [totalBids, validBids] of [
            [0, 0],
            [1, 1],
            [2, 0],
            [3, 0],
            [7, 3],
        ]) {
            const signal = assessRiskFor({ totalBids, validBids, reportedAt: REPORTED_AT });
            expect(states).toContain(signal.state);
        }
    });

    it("is pure: the same participation shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(fourBiddersOneSurvivor)).toEqual(assessRiskFor(fourBiddersOneSurvivor));
    });
});

describe("LtAwd04Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltAwd04v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying a merged-participation lot", () => {
        const procurement = testProcurement({ lots: [testLot(fourBiddersOneSurvivor)] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-AWD-04",
            subjectType: "lot",
            state: "triggered",
            rawValue: { totalBids: 4, disqualifiedShare: 0.75 },
        });
    });

    it("reports insufficient_data when no participation was observed for the lot", () => {
        const procurement = testProcurement({ lots: [testLot(null)] });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });
});
