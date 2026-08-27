import { describe, expect, it } from "vitest";
import { LtPro05Decision } from "../decision.ts";
import type { Procurement, ProcurementSubject } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    acceleratedOpenProcedure,
    acceleratedRestrictedProcedure,
    negotiatedProcedure,
    openProcedure,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-PRO-05: plain objects in, plain
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

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01" });
const ltPro05v1 = new LtPro05Decision(CONTEXT);

function testProcurement(pirkimoBudas: string | null, overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900301",
        pavadinimas: null,
        jarKodas: null,
        pirkimoBudas,
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

function procurementSubject(pirkimoBudas: string | null, overrides: Partial<Procurement> = {}): ProcurementSubject {
    const procurement = testProcurement(pirkimoBudas, overrides);
    return {
        subjectType: "procurement",
        subjectKey: "cvpis:900301",
        procurementSource: "cvpis",
        procurementId: "900301",
        procurement,
    };
}

function assessRiskFor(pirkimoBudas: string) {
    return ltPro05v1.assessRisk(procurementSubject(pirkimoBudas));
}

describe("LtPro05Decision.assessRisk", () => {
    it("triggers for an accelerated open-competition procedure", () => {
        const signal = assessRiskFor(acceleratedOpenProcedure);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ pirkimoBudas: acceleratedOpenProcedure });
    });

    it("triggers for an accelerated restricted-competition procedure", () => {
        const signal = assessRiskFor(acceleratedRestrictedProcedure);
        expect(signal.state).toBe("triggered");
    });

    it("does not trigger for a plain (non-accelerated) open competition", () => {
        const signal = assessRiskFor(openProcedure);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ pirkimoBudas: openProcedure });
    });

    it("does not trigger for a negotiated procedure that is not accelerated", () => {
        const signal = assessRiskFor(negotiatedProcedure);
        expect(signal.state).toBe("not_triggered");
    });

    it("is total: every value returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const pirkimoBudas of [
            acceleratedOpenProcedure,
            acceleratedRestrictedProcedure,
            openProcedure,
            negotiatedProcedure,
        ]) {
            const signal = assessRiskFor(pirkimoBudas);
            expect(states).toContain(signal.state);
        }
    });

    it("is pure: the same value returns a deeply equal signal every time", () => {
        expect(assessRiskFor(acceleratedOpenProcedure)).toEqual(assessRiskFor(acceleratedOpenProcedure));
    });
});

describe("LtPro05Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltPro05v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying an accelerated pirkimoBudas", () => {
        const procurement = testProcurement(acceleratedOpenProcedure);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-PRO-05",
            subjectType: "procurement",
            state: "triggered",
            rawValue: { pirkimoBudas: acceleratedOpenProcedure },
        });
    });

    it("reports not_applicable for a cvpp-sourced procurement (never carries pirkimoBudas)", () => {
        const procurement = testProcurement(null, { saltinis: "cvpp" });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("not_applicable");
    });
});
