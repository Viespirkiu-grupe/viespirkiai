import { describe, expect, it } from "vitest";
import { LtTra08Decision } from "../decision.ts";
import type { Procurement, ProcurementSubject } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import { procedureOutcome } from "./fixtures.ts";

// Unit tests for the judgement half of LT-TRA-08: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md).
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly. The
// eligibility-gate and hasRequiredData cases belong to the "end to end"
// describe block, which goes through RiskDecisionEngine itself.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01" });
const ltTra08v1 = new LtTra08Decision(CONTEXT);

function testProcurement(overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900801",
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
        subjectKey: "cvpis:900801",
        procurementSource: "cvpis",
        procurementId: "900801",
        procurement,
    };
}

function assessRiskFor(ieskinysTeismui: boolean | null) {
    return ltTra08v1.assessRisk(procurementSubject({ procedureOutcome: procedureOutcome(ieskinysTeismui) }));
}

describe("LtTra08Decision.assessRisk", () => {
    it("triggers when the report says a lawsuit was filed in court", () => {
        const signal = assessRiskFor(true);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ ieskinysTeismui: true });
        expect(signal.threshold).toEqual({ ieskinysTeismui: true });
    });

    it("does not trigger when the report positively says no lawsuit was filed", () => {
        const signal = assessRiskFor(false);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ ieskinysTeismui: false });
    });

    it("is total: every scenario returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const ieskinysTeismui of [true, false]) {
            const signal = assessRiskFor(ieskinysTeismui);
            expect(states).toContain(signal.state);
        }
    });

    it("is pure: the same scenario returns a deeply equal signal every time", () => {
        expect(assessRiskFor(true)).toEqual(assessRiskFor(true));
    });
});

describe("LtTra08Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltTra08v1], CONTEXT);

    it("assembles a complete triggered signal from a procurement whose report says a lawsuit was filed", () => {
        const procurement = testProcurement({ procedureOutcome: procedureOutcome(true) });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-TRA-08",
            subjectType: "procurement",
            state: "triggered",
            rawValue: { ieskinysTeismui: true },
        });
    });

    it("reports not_triggered for a report that positively says no lawsuit was filed", () => {
        const procurement = testProcurement({ procedureOutcome: procedureOutcome(false) });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("not_triggered");
    });

    it("reports insufficient_data when no ATN-1 report was ever filed (procedureOutcome null)", () => {
        const procurement = testProcurement({ procedureOutcome: null });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["ieskinysTeismui"]);
    });

    it("reports insufficient_data when a report was filed but never populated ieskinysTeismui", () => {
        const procurement = testProcurement({ procedureOutcome: procedureOutcome(null) });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });

    it("reports not_applicable for a cvpp-sourced procurement (never carries pirkimoBudas)", () => {
        const procurement = testProcurement({ saltinis: "cvpp", pirkimoBudas: null });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("not_applicable");
    });
});
