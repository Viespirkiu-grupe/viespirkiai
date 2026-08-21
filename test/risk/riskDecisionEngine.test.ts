import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Decision, EligibilityOutcome, Procurement, RiskIndicatorDefinition, Subject } from "../../modules/risk/types.ts";
import { ARiskIndicatorDecision } from "../../modules/risk/riskIndicatorDecision.ts";
import { RiskDecisionEngine } from "../../modules/risk/riskDecisionEngine.ts";
import type { EvaluationRun } from "../../modules/risk/evaluationContext.ts";

// Pure, no DB — RiskDecisionEngine only builds Subjects from already-loaded
// Procurements and calls each indicator's own evaluate(). See
// docs/indicators-story/risk-service-architecture-v2.md §1.2.

const paramsSchema = z.object({});
type TestDefinition = RiskIndicatorDefinition<Record<string, never>>;

function definition(overrides: Partial<TestDefinition> = {}): TestDefinition {
    return {
        key: { id: "LT-TEST-01", version: 1 },
        lifecycle: "active",
        subjectType: "procurement",
        stage: "tender",
        references: [],
        sourceRelations: [],
        requiredInputs: [],
        parameters: [{ validFrom: "2026-01-01", validTo: null, scope: {}, values: {}, source: "test" }],
        parameterSchema: paramsSchema,
        standard: { name: "test", url: "https://example.com" },
        public: { titleLt: "Testinis rodiklis", descriptionLt: "desc", formulaLt: "formula", limitationLt: "limitation" },
        ...overrides,
    };
}

// Always eligible; assessRisk() emits one not_triggered signal per subject,
// or throws when constructed with shouldThrow — the case that proves the
// engine isolates a failing indicator from the others in the same call.
class TestIndicator extends ARiskIndicatorDecision<TestDefinition> {
    readonly evaluateCalls: { subjects: readonly Subject[] }[] = [];
    private readonly shouldThrow: boolean;

    constructor(overrides: Partial<TestDefinition> = {}, shouldThrow = false) {
        super(definition(overrides));
        this.shouldThrow = shouldThrow;
    }

    protected readonly missingDataWhenAbsent: readonly string[] = [];
    protected hasRequiredData(): boolean {
        return true;
    }
    protected decide(): Decision {
        return { state: "not_triggered" };
    }
    isEligible(): EligibilityOutcome {
        return { eligible: true };
    }

    evaluate(run: EvaluationRun, subjects: readonly Subject[]) {
        this.evaluateCalls.push({ subjects });
        if (this.shouldThrow) throw new Error("boom");
        return super.evaluate(run, subjects);
    }
}

function testProcurement(overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "1",
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
        ...overrides,
    };
}

const RUN = { runId: 1, dataAsOf: "2026-08-01", subjects: null } as const;

describe("RiskDecisionEngine", () => {
    it("builds one ProcurementSubject and one LotSubject per lot, each carrying its non-null parent", () => {
        const procurement = testProcurement({
            pirkimoNumeris: "10",
            lots: [
                { subjektoRaktas: "cvpis:10:1", saltinis: "cvpis", pirkimoNumeris: "10", daliesNumeris: "1", daliesPavadinimas: null, deklaruota: true, stebeta: false, dalyviuSkaicius: null, kainuSkaicius: null, atmestuSkaicius: null, participation: null },
                { subjektoRaktas: "cvpis:10:2", saltinis: "cvpis", pirkimoNumeris: "10", daliesNumeris: "2", daliesPavadinimas: null, deklaruota: true, stebeta: false, dalyviuSkaicius: null, kainuSkaicius: null, atmestuSkaicius: null, participation: null },
            ],
        });
        const procurementIndicator = new TestIndicator({ subjectType: "procurement" });
        const lotIndicator = new TestIndicator({ key: { id: "LT-TEST-02", version: 1 }, subjectType: "lot" });
        const engine = new RiskDecisionEngine([procurementIndicator, lotIndicator]);

        engine.evaluateAll(RUN, [procurement]);

        // Every indicator is handed the same full subject universe — see the
        // next test — so both indicators' evaluateCalls carry all 3 subjects;
        // filtering by subjectType is ARiskIndicatorDecision.evaluate()'s own
        // job, not the engine's.
        const allSubjects = procurementIndicator.evaluateCalls[0].subjects;
        const procurementSubjects = allSubjects.filter((s) => s.subjectType === "procurement");
        expect(procurementSubjects).toHaveLength(1);
        expect(procurementSubjects[0]).toMatchObject({ subjectType: "procurement", subjectKey: "cvpis:10" });

        const lotSubjects = allSubjects.filter((s) => s.subjectType === "lot");
        expect(lotSubjects).toHaveLength(2);
        for (const lotSubject of lotSubjects) {
            expect(lotSubject.subjectType).toBe("lot");
            if (lotSubject.subjectType === "lot") {
                expect(lotSubject.procurement).toBe(procurement);
            }
        }
    });

    it("isolates a failing indicator: the other indicator's signals are unaffected", () => {
        const failing = new TestIndicator({ key: { id: "LT-TEST-FAIL", version: 1 } }, true);
        const healthy = new TestIndicator();
        const engine = new RiskDecisionEngine([failing, healthy]);

        const results = engine.evaluateAll(RUN, [testProcurement()]);

        const failingResult = results.find((r) => r.indicatorId === "LT-TEST-FAIL")!;
        expect(failingResult.error).toBe("boom");
        expect(failingResult.signals).toEqual([]);

        const healthyResult = results.find((r) => r.indicatorId === "LT-TEST-01")!;
        expect(healthyResult.error).toBeUndefined();
        expect(healthyResult.signals).toHaveLength(1);
        expect(healthyResult.signals[0].state).toBe("not_triggered");
    });

    it("hands every indicator the same full subject universe, and each still only signals its own subjectType", () => {
        const procurement = testProcurement({
            pirkimoNumeris: "20",
            lots: [{ subjektoRaktas: "cvpis:20:1", saltinis: "cvpis", pirkimoNumeris: "20", daliesNumeris: "1", daliesPavadinimas: null, deklaruota: true, stebeta: false, dalyviuSkaicius: null, kainuSkaicius: null, atmestuSkaicius: null, participation: null }],
        });
        const procurementIndicator = new TestIndicator({ subjectType: "procurement" });
        const lotIndicator = new TestIndicator({ key: { id: "LT-TEST-02", version: 1 }, subjectType: "lot" });
        const engine = new RiskDecisionEngine([procurementIndicator, lotIndicator]);

        const results = engine.evaluateAll(RUN, [procurement]);

        expect(procurementIndicator.evaluateCalls[0].subjects).toEqual(lotIndicator.evaluateCalls[0].subjects);

        const procurementResult = results.find((r) => r.indicatorId === "LT-TEST-01")!;
        expect(procurementResult.signals.every((s) => s.subjectType === "procurement")).toBe(true);
        const lotResult = results.find((r) => r.indicatorId === "LT-TEST-02")!;
        expect(lotResult.signals.every((s) => s.subjectType === "lot")).toBe(true);
    });

    it("calls each indicator's evaluate() exactly once per evaluateAll() call, not once per subject", () => {
        const indicator = new TestIndicator();
        const engine = new RiskDecisionEngine([indicator]);

        engine.evaluateAll(RUN, [testProcurement({ pirkimoNumeris: "1" }), testProcurement({ pirkimoNumeris: "2" })]);

        expect(indicator.evaluateCalls).toHaveLength(1);
        expect(indicator.evaluateCalls[0].subjects).toHaveLength(2);
    });
});
