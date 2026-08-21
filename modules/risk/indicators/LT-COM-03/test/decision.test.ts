import { describe, expect, it } from "vitest";
import { ltCom03v1 } from "../decision.ts";
import type { LotSubject, Procurement, ProcurementParticipation, ProcurementSubject } from "../../../types.ts";
import { EvaluationContext, type EvaluationRun } from "../../../evaluationContext.ts";
import { RiskDecisionEngine } from "../../../riskDecisionEngine.ts";
import { emptyReport, fiveSuppliers, oneSupplier, REPORTED_AT, twoSuppliers } from "./fixtures.ts";

// Unit tests for the judgement half of LT-COM-03: plain objects in, plain
// objects out, no database and no clock
// (docs/indicators-story/risk-service-architecture-v2.md). Participation
// scenarios come from fixtures.ts; procurementReader.it.ts proves the
// consolidated procurement-grain participation query (including its
// cross-lot union) actually produces them.
//
// assessRisk() assumes isEligible() already passed (riskIndicatorDecision.ts)
// — the "assessRisk" describe block below calls it directly, the way
// RiskDecisionEngine does once eligibility is settled. The eligibility-gate
// and hasRequiredData cases belong to the "end to end" describe block, which
// goes through RiskDecisionEngine itself, since that is genuinely how a
// ProcurementSubject reaches assessRisk in production.

const RUN: EvaluationRun = { runId: 1, dataAsOf: "2026-08-01", subjects: null };
const CONTEXT = new EvaluationContext(RUN, ltCom03v1.parametersAsOf(RUN.dataAsOf));

function testProcurement(participation: ProcurementParticipation | null, overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "900201",
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
        participation,
        ...overrides,
    };
}

function procurementSubject(participation: ProcurementParticipation, overrides: Partial<Procurement> = {}): ProcurementSubject {
    const procurement = testProcurement(participation, overrides);
    return {
        subjectType: "procurement",
        subjectKey: "cvpis:900201",
        procurementSource: "cvpis",
        procurementId: "900201",
        procurement,
    };
}

function assessRiskFor(participation: ProcurementParticipation) {
    return ltCom03v1.assessRisk(procurementSubject(participation), CONTEXT);
}

describe("LtCom03Decision.assessRisk", () => {
    it("triggers when only one supplier is recorded for the whole procurement", () => {
        const signal = assessRiskFor(oneSupplier);
        expect(signal.state).toBe("triggered");
        expect(signal.rawValue).toEqual({ totalSuppliers: 1 });
        expect(signal.threshold).toEqual({ minimumSuppliers: 2 });
    });

    it("does not trigger at exactly the minimum number of suppliers — the boundary at minimumSuppliers: 2", () => {
        const signal = assessRiskFor(twoSuppliers);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ totalSuppliers: 2 });
    });

    it("does not trigger with plenty of suppliers", () => {
        const signal = assessRiskFor(fiveSuppliers);
        expect(signal.state).toBe("not_triggered");
        expect(signal.rawValue).toEqual({ totalSuppliers: 5 });
    });

    it("reports insufficient_data for a report that lists no participants", () => {
        const signal = assessRiskFor(emptyReport);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });

    it("carries the report's own evidence, sourced from the procurement's own pirkimoBudas", () => {
        for (const participation of [oneSupplier, fiveSuppliers, twoSuppliers]) {
            expect(assessRiskFor(participation).evidence).toEqual({
                pirkimoBudas: "Atviras konkursas",
                ataskaitosData: participation.reportedAt,
                source: "ATN-1 ataskaita",
            });
        }
    });

    it("is total: every participation shape returns one of the four states", () => {
        const states = new Set(["triggered", "not_triggered", "insufficient_data", "not_applicable"]);
        for (const totalSuppliers of [0, 1, 2, 3, 7]) {
            const signal = assessRiskFor({ totalSuppliers, reportedAt: REPORTED_AT });
            expect(states).toContain(signal.state);
        }
    });

    it("is pure: the same participation shape returns a deeply equal signal every time", () => {
        expect(assessRiskFor(twoSuppliers)).toEqual(assessRiskFor(twoSuppliers));
    });

    it("throws when given a lot subject instead of a procurement subject", () => {
        const lotSubject: LotSubject = {
            subjectType: "lot",
            subjectKey: "cvpis:1:1",
            procurementSource: "cvpis",
            procurementId: "1",
            procurement: testProcurement(null, { pirkimoNumeris: "1" }),
            lot: {
                subjektoRaktas: "cvpis:1:1",
                saltinis: "cvpis",
                pirkimoNumeris: "1",
                daliesNumeris: "1",
                daliesPavadinimas: null,
                deklaruota: true,
                stebeta: false,
                dalyviuSkaicius: null,
                kainuSkaicius: null,
                atmestuSkaicius: null,
                participation: null,
            },
        };
        expect(() => ltCom03v1.assessRisk(lotSubject, CONTEXT)).toThrow(/expected a procurement subject/);
    });
});

describe("LtCom03Decision end to end (through RiskDecisionEngine, no database)", () => {
    const engine = new RiskDecisionEngine([ltCom03v1]);

    it("assembles a complete signal from a Procurement carrying merged cross-lot participation", () => {
        const procurement = testProcurement(oneSupplier);
        const [signal] = engine.evaluateAll(RUN, [procurement]);
        expect(signal).toMatchObject({
            indicatorId: "LT-COM-03",
            subjectType: "procurement",
            state: "triggered",
            rawValue: { totalSuppliers: 1 },
        });
    });

    it("reports insufficient_data when no participation was observed for the procurement", () => {
        const procurement = testProcurement(null);
        const [signal] = engine.evaluateAll(RUN, [procurement]);
        expect(signal.state).toBe("insufficient_data");
        expect(signal.missingData).toEqual(["tiekejoKodas"]);
    });
});
