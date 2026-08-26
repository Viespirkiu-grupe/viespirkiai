import { describe, expect, it } from "vitest";
import { LtOth03Decision } from "../decision.ts";
import type { Procurement, ProcurementProcedureOutcome, ProcurementSubject } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    DEADLINE,
    mixedLotsOneAnomalous,
    oneLotAtMaximumBoundary,
    oneLotAtMinimumBoundary,
    oneLotConcludedNoDate,
    oneLotDecidedBeforeDeadline,
    oneLotDecidedLate,
    oneLotDecidedSameDay,
    oneLotOrdinaryPeriod,
    onlyTerminatedBeforeDeadline,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-OTH-03: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Procedure-outcome
// scenarios come from fixtures.ts; procurementReader.it.ts proves the
// consolidated procurement-grain outcome query actually produces the
// per-lot (outcome, decision date) shape these fixtures assume.
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly, the way
// RiskDecisionEngine does once eligibility is settled. The eligibility-gate
// and hasRequiredData cases belong to the "end to end" describe block, which
// goes through RiskDecisionEngine itself.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01", subjects: null });
const ltOth03v1 = new LtOth03Decision(CONTEXT);

function testProcurement(procedureOutcome: ProcurementProcedureOutcome | null, overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900401",
        pavadinimas: null,
        jarKodas: null,
        pirkimoBudas: "Atviras konkursas",
        statusas: null,
        pirkimoObjektoTipas: null,
        numatomaVerteEUR: null,
        paskelbimoData: null,
        pasiulymuPateikimoTerminas: DEADLINE,
        bvpzKodai: null,
        esFinansavimas: null,
        lots: [],
        participation: null,
        procedureOutcome,
        contractSignatureDates: null,
        ...overrides,
    };
}

function procurementSubject(procedureOutcome: ProcurementProcedureOutcome | null, overrides: Partial<Procurement> = {}): ProcurementSubject {
    const procurement = testProcurement(procedureOutcome, overrides);
    return {
        subjectType: "procurement",
        subjectKey: "cvpis:900401",
        procurementSource: "cvpis",
        procurementId: "900401",
        procurement,
    };
}

function assessRiskFor(procedureOutcome: ProcurementProcedureOutcome, overrides: Partial<Procurement> = {}) {
    return ltOth03v1.assessRisk(procurementSubject(procedureOutcome, overrides));
}

describe("LtOth03Decision.assessRisk", () => {
    it("does not trigger when the period is well inside the bounds", () => {
        const signal = assessRiskFor(oneLotOrdinaryPeriod);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ periods: [{ daliesNumeris: "0", periodDays: 30 }] });
    });

    it("triggers when the decision was made the same day as the deadline — anomalously short", () => {
        const signal = assessRiskFor(oneLotDecidedSameDay);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ periods: [{ daliesNumeris: "0", periodDays: 0 }] });
    });

    it("triggers on a negative period — decided before the tender deadline", () => {
        const signal = assessRiskFor(oneLotDecidedBeforeDeadline);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ periods: [{ daliesNumeris: "0", periodDays: -12 }] });
    });

    it("does not trigger exactly at the minimum boundary (3 days is not strictly below)", () => {
        const signal = assessRiskFor(oneLotAtMinimumBoundary);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ periods: [{ daliesNumeris: "0", periodDays: 3 }] });
    });

    it("triggers when the decision came 121 days after the deadline — anomalously long", () => {
        const signal = assessRiskFor(oneLotDecidedLate);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ periods: [{ daliesNumeris: "0", periodDays: 121 }] });
    });

    it("does not trigger exactly at the maximum boundary (120 days is not strictly above)", () => {
        const signal = assessRiskFor(oneLotAtMaximumBoundary);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ periods: [{ daliesNumeris: "0", periodDays: 120 }] });
    });

    it("triggers when at least one lot of a multi-lot procurement is anomalous", () => {
        const signal = assessRiskFor(mixedLotsOneAnomalous);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({
            periods: [
                { daliesNumeris: "0", periodDays: 30 },
                { daliesNumeris: "1", periodDays: 151 },
            ],
        });
    });

    it("is total: every scenario returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const outcome of [oneLotOrdinaryPeriod, oneLotDecidedSameDay, oneLotDecidedLate, mixedLotsOneAnomalous]) {
            const signal = assessRiskFor(outcome);
            expect(states).toContain(signal.state);
        }
    });

    it("is pure: the same procedure-outcome shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(oneLotOrdinaryPeriod)).toEqual(assessRiskFor(oneLotOrdinaryPeriod));
    });
});

describe("LtOth03Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltOth03v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying merged procedure-outcome data", () => {
        const procurement = testProcurement(oneLotDecidedLate);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-OTH-03",
            subjectType: "procurement",
            state: "triggered",
        });
    });

    it("reports insufficient_data when no procedure-ending decision was observed for the procurement", () => {
        const procurement = testProcurement(null);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["sprendimoPriemimoData", "pasiulymuPateikimoTerminas"]);
    });

    it("reports insufficient_data when every lot terminated before any evaluation could happen", () => {
        const procurement = testProcurement(onlyTerminatedBeforeDeadline);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });

    it("reports insufficient_data when the concluded lot's decision date was never recorded", () => {
        const procurement = testProcurement(oneLotConcludedNoDate);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });

    it("reports insufficient_data when the procurement's own submission deadline is unknown", () => {
        const procurement = testProcurement(oneLotOrdinaryPeriod, { pasiulymuPateikimoTerminas: null });
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });
});
