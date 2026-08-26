import { describe, expect, it } from "vitest";
import { LtPri05Decision } from "../decision.ts";
import type { Procurement, ProcurementSubject } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import { boundaryValue, highValue, lowValue, veryHighValue } from "./fixtures.ts";

// Unit tests for the judgement half of LT-PRI-05: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Value scenarios
// come from fixtures.ts.
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly, the way
// RiskDecisionEngine does once eligibility is settled. The eligibility-gate
// and hasRequiredData cases belong to the "end to end" describe block, which
// goes through RiskDecisionEngine itself, since that is genuinely how a
// ProcurementSubject reaches assessRisk in production.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01", subjects: null });
const ltPri05v1 = new LtPri05Decision(CONTEXT);

function testProcurement(numatomaVerteEUR: number | null, overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900301",
        pavadinimas: null,
        jarKodas: null,
        pirkimoBudas: "Atviras konkursas",
        statusas: null,
        pirkimoObjektoTipas: null,
        numatomaVerteEUR,
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

function procurementSubject(numatomaVerteEUR: number | null, overrides: Partial<Procurement> = {}): ProcurementSubject {
    const procurement = testProcurement(numatomaVerteEUR, overrides);
    return {
        subjectType: "procurement",
        subjectKey: "cvpis:900301",
        procurementSource: "cvpis",
        procurementId: "900301",
        procurement,
    };
}

function assessRiskFor(numatomaVerteEUR: number) {
    return ltPri05v1.assessRisk(procurementSubject(numatomaVerteEUR));
}

describe("LtPri05Decision.assessRisk", () => {
    it("triggers when the estimated value is above the threshold", () => {
        const signal = assessRiskFor(highValue);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ numatomaVerteEUR: highValue });
        expect(signal.threshold).toEqual({ minimumValueEUR: 1_400_000 });
    });

    it("triggers well above the threshold", () => {
        const signal = assessRiskFor(veryHighValue);
        expect(signal.state).toBe("triggered");
    });

    it("does not trigger at exactly the boundary — minimumValueEUR: 1_400_000", () => {
        const signal = assessRiskFor(boundaryValue);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ numatomaVerteEUR: boundaryValue });
    });

    it("does not trigger for a low estimated value", () => {
        const signal = assessRiskFor(lowValue);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ numatomaVerteEUR: lowValue });
    });

    it("is total: every value returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const numatomaVerteEUR of [0, 1, lowValue, boundaryValue, highValue, veryHighValue]) {
            const signal = assessRiskFor(numatomaVerteEUR);
            expect(states).toContain(signal.state);
        }
    });

    it("is pure: the same value returns a deeply equal signal every time", () => {
        expect(assessRiskFor(highValue)).toEqual(assessRiskFor(highValue));
    });
});

describe("LtPri05Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltPri05v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying numatomaVerteEUR", () => {
        const procurement = testProcurement(highValue);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-PRI-05",
            subjectType: "procurement",
            state: "triggered",
            rawValue: { numatomaVerteEUR: highValue },
        });
    });

    it("reports insufficient_data when numatomaVerteEUR is null", () => {
        const procurement = testProcurement(null);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["numatomaVerteEUR"]);
    });

    it("reports not_applicable for a cvpp-sourced procurement (never carries a value)", () => {
        const procurement = testProcurement(null, { saltinis: "cvpp", pirkimoBudas: null });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("not_applicable");
    });
});
