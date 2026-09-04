import { describe, expect, it } from "vitest";
import type { EligibilityOutcome, BaseParameters, RiskIndicatorDefinition, RiskSignal } from "../../modules/risk/types.ts";
import { ARiskIndicatorDecision } from "../../modules/risk/riskIndicatorDecision.ts";
import { RiskIndicatorRegistry, type IndicatorClass } from "../../modules/risk/registry.ts";
import { EvaluationContext } from "../../modules/risk/evaluationContext.ts";

interface TestParameters extends BaseParameters {
    readonly threshold: number;
}
type TestDefinition = RiskIndicatorDefinition<TestParameters>;

// A minimal ARiskIndicatorDecision subclass — isEligible/assessRisk stubbed
// to satisfy the abstract contract, since these tests exercise only the
// shared parameter-timeline machinery, which is not per-indicator behaviour.
// RiskDecisionEngine (riskDecisionEngine.ts) is what actually calls
// isEligible/assessRisk per subject; that wiring is tested there, not here.
class TestDecision extends ARiskIndicatorDecision<TestDefinition> {
    constructor(definition: TestDefinition, context: EvaluationContext) {
        super(definition, context);
    }

    protected readonly missingDataWhenAbsent: readonly string[] = [];
    protected hasRequiredData(): boolean {
        return true;
    }
    isEligible(): EligibilityOutcome {
        return { eligible: true };
    }
    assessRisk(): RiskSignal {
        throw new Error("not used: these tests exercise parameterEntryFor() directly");
    }
}

const CONTEXT = new EvaluationContext({ dataAsOf: "2026-08-01" });

function testDefinition(overrides: {
    id?: string;
    version?: number;
    parameters?: TestParameters;
    public?: { titleLt: string; descriptionLt: string; formulaLt: string; limitationLt: string };
}): TestDefinition {
    return {
        key: { id: (overrides.id ?? "LT-TEST-01") as `LT-${string}`, version: overrides.version ?? 1 },
        subjectType: "procurement",
        stage: "tender",
        references: [],
        sourceRelations: [],
        requiredInputs: [],
        parameters: overrides.parameters ?? { validFrom: "2026-01-01", validTo: null, threshold: 1, source: "test" },
        standard: { name: "test", url: "https://example.com" },
        public: overrides.public ?? {
            titleLt: "Testinis rodiklis",
            descriptionLt: "desc",
            formulaLt: "formula",
            limitationLt: "limitation",
        },
    };
}

function makeIndicator(overrides: Parameters<typeof testDefinition>[0] = {}): TestDecision {
    return new TestDecision(testDefinition(overrides), CONTEXT);
}

/** Wraps a definition as an IndicatorClass — the shape RiskIndicatorRegistry holds (registry.ts). */
function indicatorClass(definition: TestDefinition): IndicatorClass {
    return class extends TestDecision {
        static readonly definition = definition;
        constructor(context: EvaluationContext) {
            super(definition, context);
        }
    };
}

describe("ARiskIndicatorDecision", () => {
    it("resolves the parameters when in force at a cutoff", () => {
        const indicator = makeIndicator({
            parameters: { validFrom: "2026-01-01", validTo: null, threshold: 2, source: "t" },
        });

        expect(indicator.parameterEntryFor("2026-08-01")).toMatchObject({ threshold: 2 });
    });

    it("resolves null at a cutoff outside the parameters' window", () => {
        const indicator = makeIndicator({});
        expect(indicator.parameterEntryFor("2020-01-01")).toBeNull();
    });

    it("resolves null at a cutoff past validTo", () => {
        const indicator = makeIndicator({
            parameters: { validFrom: "2026-01-01", validTo: "2026-07-01", threshold: 1, source: "t" },
        });
        expect(indicator.parameterEntryFor("2026-08-01")).toBeNull();
        expect(indicator.parameterEntryFor("2026-03-01")).toMatchObject({ threshold: 1 });
    });

});

describe("RiskIndicatorRegistry", () => {
    it("rejects duplicate (id, version) keys", () => {
        const a = indicatorClass(testDefinition({}));
        const b = indicatorClass(testDefinition({}));
        expect(() => new RiskIndicatorRegistry([a, b])).toThrow(/Duplicate Risk Indicator key/);
    });

    it("requires a known key and rejects an unknown one", () => {
        const definition = testDefinition({});
        const registry = new RiskIndicatorRegistry([indicatorClass(definition)]);
        expect(registry.require({ id: "LT-TEST-01", version: 1 })).toBe(definition);
        expect(() => registry.require({ id: "LT-TEST-01", version: 2 })).toThrow(/Unknown Risk Indicator/);
    });

    it("all() lists every registered definition", () => {
        const definition = testDefinition({});
        const registry = new RiskIndicatorRegistry([indicatorClass(definition)]);
        expect(registry.all()).toEqual([definition]);
    });

    it("createAllIndicators(context) builds one indicator per definition carrying a parameter entry in force at that cutoff", () => {
        const inForce = indicatorClass(
            testDefinition({
                id: "LT-TEST-01",
                parameters: { validFrom: "2026-01-01", validTo: null, threshold: 1, source: "t" },
            }),
        );
        const notYetStarted = indicatorClass(
            testDefinition({
                id: "LT-TEST-02",
                parameters: { validFrom: "2099-01-01", validTo: null, threshold: 1, source: "t" },
            }),
        );
        const alreadyEnded = indicatorClass(
            testDefinition({
                id: "LT-TEST-03",
                parameters: { validFrom: "2020-01-01", validTo: "2020-06-01", threshold: 1, source: "t" },
            }),
        );
        const registry = new RiskIndicatorRegistry([inForce, notYetStarted, alreadyEnded]);

        const indicators = registry.createAllIndicators(CONTEXT);

        expect(indicators.map((indicator) => indicator.id)).toEqual(["LT-TEST-01"]);
        expect(indicators[0].context).toBe(CONTEXT);
    });
});
