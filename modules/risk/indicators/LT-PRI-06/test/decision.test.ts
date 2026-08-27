import { describe, expect, it } from "vitest";
import { LtPri06Decision } from "../decision.ts";
import type { Procurement, ProcurementSubject } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import { boundaryValue, highValue, lowValue, procedureOutcome, veryHighValue } from "./fixtures.ts";

// Unit tests for the judgement half of LT-PRI-06: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md).
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly. The
// eligibility-gate and hasRequiredData cases belong to the "end to end"
// describe block, which goes through RiskDecisionEngine itself.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01", subjects: null });
const ltPri06v1 = new LtPri06Decision(CONTEXT);

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
        contractSignatureDates: null,
        ...overrides,
    };
}

function procurementSubject(overrides: Partial<Procurement> = {}): ProcurementSubject {
    const procurement = testProcurement(overrides);
    return {
        subjectType: "procurement",
        subjectKey: "cvpis:900301",
        procurementSource: "cvpis",
        procurementId: "900301",
        procurement,
    };
}

function assessRiskFor(isFramework: boolean, numatomaVerteEUR: number | null) {
    return ltPri06v1.assessRisk(procurementSubject({ numatomaVerteEUR, procedureOutcome: procedureOutcome(isFramework) }));
}

describe("LtPri06Decision.assessRisk", () => {
    it("triggers when a framework's estimated value is above the threshold", () => {
        const signal = assessRiskFor(true, highValue);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ isFramework: true, numatomaVerteEUR: highValue });
        expect(signal.threshold).toEqual({ minimumValueEUR: 5_000_000 });
    });

    it("triggers well above the threshold", () => {
        const signal = assessRiskFor(true, veryHighValue);
        expect(signal.state).toBe("triggered");
    });

    it("does not trigger at exactly the boundary — minimumValueEUR: 5_000_000", () => {
        const signal = assessRiskFor(true, boundaryValue);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ isFramework: true, numatomaVerteEUR: boundaryValue });
    });

    it("does not trigger for a framework with a low estimated value", () => {
        const signal = assessRiskFor(true, lowValue);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ isFramework: true, numatomaVerteEUR: lowValue });
    });

    it("does not trigger for a non-framework procurement, regardless of value", () => {
        const signal = assessRiskFor(false, veryHighValue);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ isFramework: false });
    });

    it("is total: every scenario returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const isFramework of [true, false]) {
            for (const value of [0, 1, lowValue, boundaryValue, highValue, veryHighValue]) {
                const signal = assessRiskFor(isFramework, value);
                expect(states).toContain(signal.state);
            }
        }
    });

    it("is pure: the same scenario returns a deeply equal signal every time", () => {
        expect(assessRiskFor(true, highValue)).toEqual(assessRiskFor(true, highValue));
    });
});

describe("LtPri06Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltPri06v1], CONTEXT);

    it("assembles a complete triggered signal from a framework procurement with a high value", () => {
        const procurement = testProcurement({ numatomaVerteEUR: highValue, procedureOutcome: procedureOutcome(true) });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-PRI-06",
            subjectType: "procurement",
            state: "triggered",
            rawValue: { isFramework: true, numatomaVerteEUR: highValue },
        });
    });

    it("reports not_triggered for a report that positively says this is not a framework, with no value known", () => {
        const procurement = testProcurement({ numatomaVerteEUR: null, procedureOutcome: procedureOutcome(false) });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("not_triggered");
    });

    it("reports insufficient_data when no ATN-1 report was ever filed (procedureOutcome null)", () => {
        const procurement = testProcurement({ numatomaVerteEUR: highValue, procedureOutcome: null });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["preliminariSutartis", "numatomaVerteEUR"]);
    });

    it("reports insufficient_data when a report was filed but never populated preliminariSutartis", () => {
        const procurement = testProcurement({ numatomaVerteEUR: highValue, procedureOutcome: procedureOutcome(null) });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });

    it("reports insufficient_data for a known framework whose numatomaVerteEUR is unknown", () => {
        const procurement = testProcurement({ numatomaVerteEUR: null, procedureOutcome: procedureOutcome(true) });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });

    it("reports not_applicable for a cvpp-sourced procurement (never carries a value)", () => {
        const procurement = testProcurement({ saltinis: "cvpp", pirkimoBudas: null });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("not_applicable");
    });
});
