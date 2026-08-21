import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { EligibilityOutcome, Lot, Procurement, RiskIndicatorDefinition, RiskSignal, Subject } from "../../modules/risk/types.ts";
import { ARiskIndicatorDecision } from "../../modules/risk/riskIndicatorDecision.ts";
import { RiskDecisionEngine } from "../../modules/risk/riskDecisionEngine.ts";
import type { EvaluationContext, EvaluationRun } from "../../modules/risk/evaluationContext.ts";

// Pure, no DB — RiskDecisionEngine is the only place that batches over
// Procurements/lots and every registered indicator
// (docs/indicators-story/risk-service-architecture-v2.md §1.2:
// evaluateAll/evaluateProcurement/evaluateLot). A Risk Indicator itself only
// ever decides one subject at a time (isEligible/assessRisk) — these tests
// exist to prove the Engine, not the indicator base class, owns the loop.

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

// Always eligible; assessRisk() records every subject it was called with (so
// tests can assert which subjects the Engine routed to it), and either
// throws, returns a caller-supplied signal, or defaults to not_triggered.
class TestIndicator extends ARiskIndicatorDecision<TestDefinition> {
    readonly assessRiskCalls: Subject[] = [];
    private readonly shouldThrow: boolean;
    private readonly signalOverride?: (subject: Subject) => RiskSignal;

    constructor(
        overrides: Partial<TestDefinition> = {},
        options: { shouldThrow?: boolean; signalOverride?: (subject: Subject) => RiskSignal } = {},
    ) {
        super(definition(overrides));
        this.shouldThrow = options.shouldThrow ?? false;
        this.signalOverride = options.signalOverride;
    }

    protected readonly missingDataWhenAbsent: readonly string[] = [];
    protected hasRequiredData(): boolean {
        return true;
    }
    isEligible(): EligibilityOutcome {
        return { eligible: true };
    }

    assessRisk(subject: Subject, context: EvaluationContext): RiskSignal {
        this.assessRiskCalls.push(subject);
        if (this.shouldThrow) throw new Error("boom");
        if (this.signalOverride) return this.signalOverride(subject);
        return this.signalFor(subject, context, { state: "not_triggered" });
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

function testLot(pirkimoNumeris: string, daliesNumeris: string): Lot {
    return {
        subjektoRaktas: `cvpis:${pirkimoNumeris}:${daliesNumeris}`,
        saltinis: "cvpis",
        pirkimoNumeris,
        daliesNumeris,
        daliesPavadinimas: null,
        deklaruota: true,
        stebeta: false,
        dalyviuSkaicius: null,
        kainuSkaicius: null,
        atmestuSkaicius: null,
        participation: null,
    };
}

const RUN: EvaluationRun = { runId: 1, dataAsOf: "2026-08-01", subjects: null };

describe("RiskDecisionEngine", () => {
    it("builds one ProcurementSubject and one LotSubject per lot, each carrying its non-null parent", () => {
        const procurement = testProcurement({ pirkimoNumeris: "10", lots: [testLot("10", "1"), testLot("10", "2")] });
        const procurementIndicator = new TestIndicator({ subjectType: "procurement" });
        const lotIndicator = new TestIndicator({ key: { id: "LT-TEST-02", version: 1 }, subjectType: "lot" });
        const engine = new RiskDecisionEngine([procurementIndicator, lotIndicator]);

        engine.evaluateAll(RUN, [procurement]);

        expect(procurementIndicator.assessRiskCalls).toHaveLength(1);
        expect(procurementIndicator.assessRiskCalls[0]).toMatchObject({ subjectType: "procurement", subjectKey: "cvpis:10" });

        expect(lotIndicator.assessRiskCalls).toHaveLength(2);
        for (const lotSubject of lotIndicator.assessRiskCalls) {
            expect(lotSubject.subjectType).toBe("lot");
            if (lotSubject.subjectType === "lot") {
                expect(lotSubject.procurement).toBe(procurement);
            }
        }
    });

    it("isolates a failing indicator: the other indicator's signals are unaffected", () => {
        const failing = new TestIndicator({ key: { id: "LT-TEST-FAIL", version: 1 } }, { shouldThrow: true });
        const healthy = new TestIndicator();
        const engine = new RiskDecisionEngine([failing, healthy]);

        const signals = engine.evaluateAll(RUN, [testProcurement()]);

        expect(signals.find((s) => s.indicatorId === "LT-TEST-FAIL")).toBeUndefined();
        const healthySignal = signals.find((s) => s.indicatorId === "LT-TEST-01");
        expect(healthySignal?.state).toBe("not_triggered");
    });

    it("only routes procurement subjects to a procurement-subjectType indicator, and lot subjects to a lot-subjectType one", () => {
        const procurement = testProcurement({ pirkimoNumeris: "20", lots: [testLot("20", "1")] });
        const procurementIndicator = new TestIndicator({ subjectType: "procurement" });
        const lotIndicator = new TestIndicator({ key: { id: "LT-TEST-02", version: 1 }, subjectType: "lot" });
        const engine = new RiskDecisionEngine([procurementIndicator, lotIndicator]);

        engine.evaluateAll(RUN, [procurement]);

        expect(procurementIndicator.assessRiskCalls.every((s) => s.subjectType === "procurement")).toBe(true);
        expect(lotIndicator.assessRiskCalls.every((s) => s.subjectType === "lot")).toBe(true);
    });

    it("calls assessRisk exactly once per (indicator, subject) pair across the whole run", () => {
        const indicator = new TestIndicator();
        const engine = new RiskDecisionEngine([indicator]);

        engine.evaluateAll(RUN, [testProcurement({ pirkimoNumeris: "1" }), testProcurement({ pirkimoNumeris: "2" })]);

        expect(indicator.assessRiskCalls).toHaveLength(2);
    });

    it("validates each indicator's own signals at the end — a duplicate subject observation still throws", () => {
        const duplicateKey = "cvpis:DUPLICATE";
        const indicator = new TestIndicator(
            {},
            {
                signalOverride: () => ({
                    indicatorId: "LT-TEST-01",
                    indicatorVersion: 1,
                    subjectType: "procurement",
                    subjectKey: duplicateKey,
                    procurementSource: "cvpis",
                    procurementId: "1",
                    state: "not_triggered",
                    rawValue: null,
                    threshold: null,
                    appliedParameters: null,
                    evidence: {},
                    missingData: [],
                    dataAsOf: RUN.dataAsOf,
                }),
            },
        );
        const engine = new RiskDecisionEngine([indicator]);

        expect(() =>
            engine.evaluateAll(RUN, [testProcurement({ pirkimoNumeris: "1" }), testProcurement({ pirkimoNumeris: "2" })]),
        ).toThrow(/duplicate observation for subject/);
    });
});
