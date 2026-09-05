import { describe, expect, it } from "vitest";
import { LtPro08Decision } from "../decision.ts";
import type { Procurement, ProcurementSubject } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    DEADLINE_AT_BOUNDARY,
    DEADLINE_BEFORE_PUBLISHED,
    DEADLINE_ORDINARY,
    DEADLINE_SAME_DAY,
    DEADLINE_SHORT,
    PUBLISHED,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-PRO-08: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Value scenarios
// come from fixtures.ts.
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly, the way
// RiskDecisionEngine does once eligibility is settled. The eligibility-gate
// (including this indicator's own Rinkos konsultacija override) and
// hasRequiredData cases belong to the "end to end" describe block, which
// goes through RiskDecisionEngine itself.

const CONTEXT = new EvaluationContext({ dataAsOf: "2026-08-01" });
const ltPro08v1 = new LtPro08Decision(CONTEXT);

function testProcurement(pasiulymuPateikimoTerminas: string | null, overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900801",
        pavadinimas: null,
        jarKodas: null,
        pirkimoBudas: "Atviras konkursas",
        statusas: null,
        pirkimoObjektoTipas: null,
        numatomaVerteEUR: null,
        paskelbimoData: PUBLISHED,
        pasiulymuPateikimoTerminas,
        bvpzKodai: null,
        esFinansavimas: null,
        lots: [],
        participation: null,
        procedureOutcome: null,
        contractSignatureDates: null,
        ...overrides,
    };
}

function procurementSubject(pasiulymuPateikimoTerminas: string | null, overrides: Partial<Procurement> = {}): ProcurementSubject {
    const procurement = testProcurement(pasiulymuPateikimoTerminas, overrides);
    return {
        subjectType: "procurement",
        subjectKey: "cvpis:900801",
        procurementSource: "cvpis",
        procurementId: "900801",
        procurement,
    };
}

function assessRiskFor(pasiulymuPateikimoTerminas: string, overrides: Partial<Procurement> = {}) {
    return ltPro08v1.assessRisk(procurementSubject(pasiulymuPateikimoTerminas, overrides));
}

describe("LtPro08Decision.assessRisk", () => {
    it("triggers when the submission period is well below the bound", () => {
        const signal = assessRiskFor(DEADLINE_SHORT);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ periodDays: 2 });
    });

    it("does not trigger exactly at the boundary (5 days is not strictly below)", () => {
        const signal = assessRiskFor(DEADLINE_AT_BOUNDARY);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ periodDays: 5 });
    });

    it("does not trigger for an ordinary period", () => {
        const signal = assessRiskFor(DEADLINE_ORDINARY);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ periodDays: 14 });
    });

    it("is total: every scenario returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const deadline of [DEADLINE_SHORT, DEADLINE_AT_BOUNDARY, DEADLINE_ORDINARY]) {
            const signal = assessRiskFor(deadline);
            expect(states).toContain(signal.state);
        }
    });

    it("is pure: the same value returns a deeply equal signal every time", () => {
        expect(assessRiskFor(DEADLINE_SHORT)).toEqual(assessRiskFor(DEADLINE_SHORT));
    });
});

describe("LtPro08Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltPro08v1], CONTEXT);

    it("assembles a complete signal from a Procurement with a short submission period", () => {
        const procurement = testProcurement(DEADLINE_SHORT);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-PRO-08",
            subjectType: "procurement",
            state: "triggered",
            rawValue: { periodDays: 2 },
        });
    });

    it("reports not_applicable for a cvpp-sourced procurement (never carries pirkimoBudas)", () => {
        const procurement = testProcurement(DEADLINE_SHORT, { saltinis: "cvpp", pirkimoBudas: null });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("not_applicable");
    });

    it("reports not_applicable for a market-consultation procedure (Rinkos konsultacija)", () => {
        const procurement = testProcurement(DEADLINE_SHORT, { pirkimoBudas: "Rinkos konsultacija" });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("not_applicable");
    });

    it("reports insufficient_data when the submission deadline is unknown", () => {
        const procurement = testProcurement(null);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["paskelbimoData", "pasiulymuPateikimoTerminas"]);
    });

    it("reports insufficient_data when the publication date is unknown", () => {
        const procurement = testProcurement(DEADLINE_SHORT, { paskelbimoData: null });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });

    it("reports insufficient_data for a zero-day period (deadline same day as publication)", () => {
        const procurement = testProcurement(DEADLINE_SAME_DAY);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });

    it("reports insufficient_data for a negative period (deadline before publication)", () => {
        const procurement = testProcurement(DEADLINE_BEFORE_PUBLISHED);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });
});
