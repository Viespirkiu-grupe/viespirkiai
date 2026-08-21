import { describe, expect, it } from "vitest";
import type { EligibilityOutcome, ParameterEntry, RiskIndicatorDefinition, RiskSignal } from "../../modules/risk/types.ts";
import { ARiskIndicatorDecision } from "../../modules/risk/riskIndicatorDecision.ts";
import { RiskIndicatorRegistry } from "../../modules/risk/registry.ts";
import { z } from "zod";

const paramsSchema = z.object({ threshold: z.number() });

type TestParameters = z.infer<typeof paramsSchema>;
type TestDefinition = RiskIndicatorDefinition<TestParameters>;

// A minimal ARiskIndicatorDecision subclass — isEligible/assessRisk stubbed
// to satisfy the abstract contract, since these tests exercise only the
// shared parameter-timeline machinery and validateObservations(), neither of
// which is per-indicator behaviour. RiskDecisionEngine (riskDecisionEngine.ts)
// is what actually calls isEligible/assessRisk per subject; that wiring is
// tested there, not here.
class TestDecision extends ARiskIndicatorDecision<TestDefinition> {
    constructor(definition: TestDefinition) {
        super(definition);
    }

    protected readonly missingDataWhenAbsent: readonly string[] = [];
    protected hasRequiredData(): boolean {
        return true;
    }
    isEligible(): EligibilityOutcome {
        return { eligible: true };
    }
    assessRisk(): RiskSignal {
        throw new Error("not used: these tests call validateObservations() directly");
    }
}

function makeIndicator(overrides: {
    id?: string;
    version?: number;
    lifecycle?: "draft" | "shadow" | "active" | "retired";
    parameters?: readonly ParameterEntry<TestParameters>[];
    public?: { titleLt: string; descriptionLt: string; formulaLt: string; limitationLt: string };
}): TestDecision {
    return new TestDecision({
        key: { id: (overrides.id ?? "LT-TEST-01") as `LT-${string}`, version: overrides.version ?? 1 },
        lifecycle: overrides.lifecycle ?? "active",
        subjectType: "procurement",
        stage: "tender",
        references: [],
        sourceRelations: [],
        requiredInputs: [],
        parameters: overrides.parameters ?? [
            { validFrom: "2026-01-01", validTo: null, scope: {}, values: { threshold: 1 }, source: "test" },
        ],
        parameterSchema: paramsSchema,
        standard: { name: "test", url: "https://example.com" },
        public: overrides.public ?? {
            titleLt: "Testinis rodiklis",
            descriptionLt: "desc",
            formulaLt: "formula",
            limitationLt: "limitation",
        },
    });
}

function observation(overrides: Partial<RiskSignal> = {}): RiskSignal {
    return {
        indicatorId: "LT-TEST-01",
        indicatorVersion: 1,
        subjectType: "procurement",
        subjectKey: "cvpis:1",
        procurementSource: "cvpis",
        procurementId: "1",
        state: "triggered",
        rawValue: null,
        threshold: null,
        appliedParameters: null,
        evidence: {},
        missingData: [],
        dataAsOf: "2026-08-01",
        ...overrides,
    };
}

describe("ARiskIndicatorDecision", () => {
    it("rejects a definition with empty public wording", () => {
        expect(() =>
            makeIndicator({
                id: "LT-TEST-05",
                public: { titleLt: "", descriptionLt: "d", formulaLt: "f", limitationLt: "l" },
            }),
        ).toThrow(/titleLt and public.limitationLt must be non-empty/);
    });

    // The whole reason a definition carries a parameter schema. Entries are
    // git-maintained literals typed as ParameterEntry<P>, so tsc already
    // rejects a wrong shape; what it cannot state is that a threshold must be
    // a positive integer, and a zero or fractional value is exactly the typo a
    // review of a one-line threshold diff waves through.
    it("rejects a parameter value that violates a constraint the type cannot state", () => {
        const refined = z.object({ threshold: z.number().int().positive() });
        const withValue = (threshold: number) =>
            new TestDecision({
                key: { id: "LT-TEST-09", version: 1 },
                lifecycle: "active",
                subjectType: "procurement",
                stage: "tender",
                references: [],
                sourceRelations: [],
                requiredInputs: [],
                parameters: [{ validFrom: "2026-01-01", validTo: null, scope: {}, values: { threshold }, source: "t" }],
                parameterSchema: refined,
                standard: { name: "test", url: "https://example.com" },
                public: {
                    titleLt: "Testinis rodiklis",
                    descriptionLt: "desc",
                    formulaLt: "formula",
                    limitationLt: "limitation",
                },
            });

        expect(() => withValue(0)).toThrow();
        expect(() => withValue(-1)).toThrow();
        expect(() => withValue(1.5)).toThrow();
        expect(() => withValue(2)).not.toThrow();
    });

    it("rejects a parameter timeline with a gap", () => {
        expect(() =>
            makeIndicator({
                parameters: [
                    { validFrom: "2026-01-01", validTo: "2026-06-01", scope: {}, values: { threshold: 1 }, source: "t" },
                    { validFrom: "2026-07-01", validTo: null, scope: {}, values: { threshold: 2 }, source: "t" },
                ],
            }),
        ).toThrow(/gap or overlap/);
    });

    it("rejects a parameter timeline with an overlap", () => {
        expect(() =>
            makeIndicator({
                parameters: [
                    { validFrom: "2026-01-01", validTo: "2026-07-01", scope: {}, values: { threshold: 1 }, source: "t" },
                    { validFrom: "2026-06-01", validTo: null, scope: {}, values: { threshold: 2 }, source: "t" },
                ],
            }),
        ).toThrow(/gap or overlap/);
    });

    // One implementation version, two legal thresholds — the case §4.5
    // exists for. Contiguity is per scope, so these two timelines are checked
    // independently and neither has a gap.
    it("accepts concurrent entries whose scopes are disjoint", () => {
        const indicator = makeIndicator({
            parameters: [
                { validFrom: "2026-01-01", validTo: null, scope: { methods: ["open"] }, values: { threshold: 1 }, source: "t" },
                { validFrom: "2026-01-01", validTo: null, scope: { methods: ["restricted"] }, values: { threshold: 2 }, source: "t" },
            ],
        });
        expect(indicator.parametersAsOf("2026-08-01")).toHaveLength(2);
    });

    it("rejects concurrent entries whose scopes both admit the same subject", () => {
        expect(() =>
            makeIndicator({
                parameters: [
                    { validFrom: "2026-01-01", validTo: null, scope: { methods: ["open"] }, values: { threshold: 1 }, source: "t" },
                    { validFrom: "2026-01-01", validTo: null, scope: { methods: ["open", "restricted"] }, values: { threshold: 2 }, source: "t" },
                ],
            }),
        ).toThrow(/overlapping scopes/);
    });

    it("rejects a scoped entry concurrent with an unscoped one", () => {
        expect(() =>
            makeIndicator({
                parameters: [
                    { validFrom: "2026-01-01", validTo: null, scope: {}, values: { threshold: 1 }, source: "t" },
                    { validFrom: "2026-02-01", validTo: null, scope: { methods: ["open"] }, values: { threshold: 2 }, source: "t" },
                ],
            }),
        ).toThrow(/overlapping scopes/);
    });

    it("accepts entries with overlapping scopes when they do not overlap in time", () => {
        expect(() =>
            makeIndicator({
                parameters: [
                    { validFrom: "2026-01-01", validTo: "2026-06-01", scope: {}, values: { threshold: 1 }, source: "t" },
                    { validFrom: "2026-06-01", validTo: null, scope: { methods: ["open"] }, values: { threshold: 2 }, source: "t" },
                ],
            }),
        ).not.toThrow();
    });

    it("resolves the entry whose scope admits the subject", () => {
        const indicator = makeIndicator({
            parameters: [
                { validFrom: "2026-01-01", validTo: null, scope: { methods: ["open"] }, values: { threshold: 1 }, source: "t" },
                { validFrom: "2026-01-01", validTo: null, scope: { methods: ["restricted"] }, values: { threshold: 2 }, source: "t" },
            ],
        });
        const facts = { subjectKey: "cvpis:1", procurementSource: "cvpis", procurementId: "1" };

        expect(indicator.parameterEntryFor("2026-08-01", { ...facts, method: "restricted" })?.values).toEqual({
            threshold: 2,
        });
        // A constrained dimension the subject cannot answer matches nothing,
        // so the caller reports not_applicable rather than guessing.
        expect(indicator.parameterEntryFor("2026-08-01", { ...facts, method: null })).toBeNull();
        expect(indicator.parameterEntryFor("2026-08-01", { ...facts, method: "negotiated" })).toBeNull();
    });

    it("resolves no entry at a cutoff outside the timeline", () => {
        const indicator = makeIndicator({});
        const facts = { subjectKey: "cvpis:1", procurementSource: "cvpis", procurementId: "1" };
        expect(indicator.parameterEntryFor("2020-01-01", facts)).toBeNull();
    });

    it("rejects validTo earlier than validFrom", () => {
        expect(() =>
            makeIndicator({
                parameters: [
                    { validFrom: "2026-07-01", validTo: "2026-01-01", scope: {}, values: { threshold: 1 }, source: "t" },
                ],
            }),
        ).toThrow(/earlier than validFrom/);
    });

    it("resolves the effective entry of a contiguous timeline at a cutoff", () => {
        const indicator = makeIndicator({
            parameters: [
                { validFrom: "2026-01-01", validTo: "2026-07-01", scope: {}, values: { threshold: 1 }, source: "t" },
                { validFrom: "2026-07-01", validTo: null, scope: {}, values: { threshold: 2 }, source: "t" },
            ],
        });
        expect(indicator.parametersAsOf("2026-08-01")).toEqual([indicator.parameters[1]]);
        expect(indicator.parametersAsOf("2026-03-01")).toEqual([indicator.parameters[0]]);
    });

    it("validates rows against the output contract", () => {
        const indicator = makeIndicator({});
        expect(indicator.validateObservations([observation()])).toEqual([observation()]);
    });

    it("rejects an observation carrying another indicator's identity", () => {
        const indicator = makeIndicator({});
        expect(() => indicator.validateObservations([observation({ indicatorVersion: 2 })])).toThrow(
            /observation carries indicator identity/,
        );
    });

    it("rejects an observation whose subjectType differs from the declared one", () => {
        const indicator = makeIndicator({});
        expect(() => indicator.validateObservations([observation({ subjectType: "lot" })])).toThrow(
            /does not match the indicator's declared/,
        );
    });

    it("rejects two observations about the same subject", () => {
        const indicator = makeIndicator({});
        expect(() => indicator.validateObservations([observation(), observation()])).toThrow(
            /duplicate observation for subject/,
        );
    });
});

describe("RiskIndicatorRegistry", () => {
    it("rejects duplicate (id, version) keys", () => {
        const a = makeIndicator({});
        const b = makeIndicator({});
        expect(() => new RiskIndicatorRegistry([a, b])).toThrow(/Duplicate Risk Indicator key/);
    });

    it("rejects two active versions of the same indicator", () => {
        const v1 = makeIndicator({ version: 1, lifecycle: "active" });
        const v2 = makeIndicator({ version: 2, lifecycle: "active" });
        expect(() => new RiskIndicatorRegistry([v1, v2])).toThrow(/more than one active version/);
    });

    it("allows one active and one retired version of the same indicator", () => {
        const v1 = makeIndicator({ version: 1, lifecycle: "retired" });
        const v2 = makeIndicator({ version: 2, lifecycle: "active" });
        const registry = new RiskIndicatorRegistry([v1, v2]);
        expect(registry.active().map((indicator) => indicator.key)).toEqual([{ id: "LT-TEST-01", version: 2 }]);
    });

    it("requires a known key and rejects an unknown one", () => {
        const indicator = makeIndicator({});
        const registry = new RiskIndicatorRegistry([indicator]);
        expect(registry.require({ id: "LT-TEST-01", version: 1 })).toBe(indicator);
        expect(() => registry.require({ id: "LT-TEST-01", version: 2 })).toThrow(/Unknown Risk Indicator/);
    });

    it("evaluable() includes active and shadow but not draft or retired", () => {
        const active = makeIndicator({ id: "LT-TEST-01", lifecycle: "active" });
        const shadow = makeIndicator({ id: "LT-TEST-02", lifecycle: "shadow" });
        const draft = makeIndicator({ id: "LT-TEST-03", lifecycle: "draft" });
        const retired = makeIndicator({ id: "LT-TEST-04", lifecycle: "retired" });
        const registry = new RiskIndicatorRegistry([active, shadow, draft, retired]);
        expect(registry.evaluable().map((indicator) => indicator.id)).toEqual(["LT-TEST-01", "LT-TEST-02"]);
    });
});
