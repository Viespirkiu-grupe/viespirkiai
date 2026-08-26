import { describe, expect, it } from "vitest";
import { LtOth04Decision } from "../decision.ts";
import type { Procurement, ProcurementProcedureOutcome, ProcurementSubject } from "../../../types.ts";
import { EvaluationContext } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import {
    mixedLotsOneAnomalous,
    mixedLotsOneAnomalousSignatures,
    oneLotAtMaximumBoundary,
    oneLotAtMaximumBoundarySignatures,
    oneLotConcludedNoDate,
    oneLotOrdinaryPeriod,
    oneLotOrdinaryPeriodSignatures,
    oneLotSignedLate,
    oneLotSignedLateSignatures,
    oneLotSignedSameDay,
    oneLotSignedSameDaySignatures,
    onlyContractPredatesDecision,
    onlyContractPredatesDecisionSignatures,
    onlyTerminated,
} from "./fixtures.ts";

// Unit tests for the judgement half of LT-OTH-04: plain objects in, plain
// objects out, no database and no clock. Procedure-outcome and
// contract-signature scenarios come from fixtures.ts;
// test/risk/procurementReader.it.ts proves the two consolidated
// procurement-grain queries actually produce these shapes.
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly, the way
// RiskDecisionEngine does once eligibility is settled. The eligibility-gate
// and hasRequiredData cases belong to the "end to end" describe block, which
// goes through RiskDecisionEngine itself.

const CONTEXT = new EvaluationContext({ runId: 1, dataAsOf: "2026-08-01" });
const ltOth04v1 = new LtOth04Decision(CONTEXT);

function testProcurement(
    procedureOutcome: ProcurementProcedureOutcome | null,
    contractSignatureDates: readonly string[] | null,
    overrides: Partial<Procurement> = {},
): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900501",
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
        procedureOutcome,
        contractSignatureDates,
        ...overrides,
    };
}

function procurementSubject(
    procedureOutcome: ProcurementProcedureOutcome | null,
    contractSignatureDates: readonly string[] | null,
    overrides: Partial<Procurement> = {},
): ProcurementSubject {
    const procurement = testProcurement(procedureOutcome, contractSignatureDates, overrides);
    return {
        subjectType: "procurement",
        subjectKey: "cvpis:900501",
        procurementSource: "cvpis",
        procurementId: "900501",
        procurement,
    };
}

function assessRiskFor(procedureOutcome: ProcurementProcedureOutcome, contractSignatureDates: readonly string[] | null) {
    return ltOth04v1.assessRisk(procurementSubject(procedureOutcome, contractSignatureDates));
}

describe("LtOth04Decision.assessRisk", () => {
    it("does not trigger when the period is well inside the bound", () => {
        const signal = assessRiskFor(oneLotOrdinaryPeriod, oneLotOrdinaryPeriodSignatures);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ periods: [{ daliesNumeris: "0", periodDays: 11 }] });
    });

    it("does not trigger when signed the same day as the decision", () => {
        const signal = assessRiskFor(oneLotSignedSameDay, oneLotSignedSameDaySignatures);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ periods: [{ daliesNumeris: "0", periodDays: 0 }] });
    });

    it("does not trigger exactly at the maximum boundary (36 days is not strictly above)", () => {
        const signal = assessRiskFor(oneLotAtMaximumBoundary, oneLotAtMaximumBoundarySignatures);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ periods: [{ daliesNumeris: "0", periodDays: 36 }] });
    });

    it("triggers when signed 37 days after the decision — anomalously long", () => {
        const signal = assessRiskFor(oneLotSignedLate, oneLotSignedLateSignatures);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ periods: [{ daliesNumeris: "0", periodDays: 37 }] });
    });

    it("triggers when at least one lot of a multi-lot procurement is anomalous", () => {
        const signal = assessRiskFor(mixedLotsOneAnomalous, mixedLotsOneAnomalousSignatures);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({
            periods: [
                { daliesNumeris: "0", periodDays: 11 },
                { daliesNumeris: "1", periodDays: 47 },
            ],
        });
    });

    it("picks the earliest signature on or after the decision, never one that predates it", () => {
        // Two candidate signatures: one before the decision (must be
        // ignored — see README.md's dirty-pirkimoNumeris finding) and one
        // 20 days after it.
        const signal = assessRiskFor(oneLotOrdinaryPeriod, ["2020-11-04", "2026-01-21"]);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ periods: [{ daliesNumeris: "0", periodDays: 20 }] });
    });

    it("is total: every scenario returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        const scenarios: [ProcurementProcedureOutcome, readonly string[]][] = [
            [oneLotOrdinaryPeriod, oneLotOrdinaryPeriodSignatures],
            [oneLotSignedLate, oneLotSignedLateSignatures],
            [mixedLotsOneAnomalous, mixedLotsOneAnomalousSignatures],
        ];
        for (const [outcome, signatures] of scenarios) {
            const signal = assessRiskFor(outcome, signatures);
            expect(states).toContain(signal.state);
        }
    });

    it("is pure: the same shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(oneLotOrdinaryPeriod, oneLotOrdinaryPeriodSignatures)).toEqual(
            assessRiskFor(oneLotOrdinaryPeriod, oneLotOrdinaryPeriodSignatures),
        );
    });
});

describe("LtOth04Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltOth04v1], CONTEXT);

    it("assembles a complete signal from a Procurement carrying merged outcome and signature data", () => {
        const procurement = testProcurement(oneLotSignedLate, oneLotSignedLateSignatures);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal).toMatchObject({
            indicatorId: "LT-OTH-04",
            subjectType: "procurement",
            state: "triggered",
        });
    });

    it("reports insufficient_data when no procedure-ending decision was observed for the procurement", () => {
        const procurement = testProcurement(null, oneLotOrdinaryPeriodSignatures);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["sprendimoPriemimoData", "sudarymoData"]);
    });

    it("reports insufficient_data when no contract resolved to this procurement's pirkimoNumeris at all", () => {
        const procurement = testProcurement(oneLotOrdinaryPeriod, null);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });

    it("reports insufficient_data when every candidate contract signature predates the decision", () => {
        const procurement = testProcurement(onlyContractPredatesDecision, onlyContractPredatesDecisionSignatures);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });

    it("reports insufficient_data when every lot terminated before any award decision", () => {
        const procurement = testProcurement(onlyTerminated, oneLotOrdinaryPeriodSignatures);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });

    it("reports insufficient_data when the concluded lot's decision date was never recorded", () => {
        const procurement = testProcurement(oneLotConcludedNoDate, oneLotOrdinaryPeriodSignatures);
        const [signal] = engine.evaluateAll([procurement])[0].signals;
        expect(signal.state).toBe("insufficient_data");
    });
});
