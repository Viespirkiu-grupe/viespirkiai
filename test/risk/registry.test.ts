import { describe, expect, it } from "vitest";
import { zodContract, type ParameterEntry, type RiskObservationV1 } from "../../modules/risk/contracts.ts";
import { RiskIndicator, type RiskIndicatorDefinition } from "../../modules/risk/riskIndicator.ts";
import { RiskIndicatorRegistry } from "../../modules/risk/registry.ts";
import { z } from "zod";

const paramsSchema = z.object({ threshold: z.number() });
const paramsContract = zodContract(paramsSchema);

type TestParameters = z.infer<typeof paramsSchema>;

// An indicator whose calculation is a plain function — the shape an indicator
// with an internal structure takes (§4.3's own `calculate()` case), and the
// cheapest subclass to assert the shared behaviour of the base class on.
class TestRiskIndicator extends RiskIndicator<TestParameters> {
    private readonly observations: readonly RiskObservationV1[];

    constructor(definition: RiskIndicatorDefinition<TestParameters>, observations: readonly RiskObservationV1[] = []) {
        super(definition);
        this.observations = observations;
    }

    protected async calculate(): Promise<readonly RiskObservationV1[]> {
        return this.observations;
    }
}

function makeIndicator(
    overrides: {
        id?: string;
        version?: number;
        lifecycle?: "draft" | "shadow" | "active" | "retired";
        parameters?: readonly ParameterEntry<TestParameters>[];
        public?: { titleLt: string; descriptionLt: string; formulaLt: string; limitationLt: string };
    },
    observations: readonly RiskObservationV1[] = [],
): TestRiskIndicator {
    return new TestRiskIndicator(
        {
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
            parameterContract: paramsContract,
            standard: { name: "test", url: "https://example.com" },
            public: overrides.public ?? {
                titleLt: "Testinis rodiklis",
                descriptionLt: "desc",
                formulaLt: "formula",
                limitationLt: "limitation",
            },
        },
        observations,
    );
}

function observation(overrides: Partial<RiskObservationV1> = {}): RiskObservationV1 {
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

const RUN = { runId: 1, dataAsOf: "2026-08-01", subjects: null } as const;
const NO_DATA = { query: async () => [] };

describe("RiskIndicator", () => {
    it("rejects a definition with empty public wording", () => {
        expect(() =>
            makeIndicator({
                id: "LT-TEST-05",
                public: { titleLt: "", descriptionLt: "d", formulaLt: "f", limitationLt: "l" },
            }),
        ).toThrow(/titleLt and public.limitationLt must be non-empty/);
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
        const subject = { subjectKey: "cvpis:1", procurementSource: "cvpis", procurementId: "1" };

        expect(indicator.parameterEntryFor("2026-08-01", { ...subject, method: "restricted" })?.values).toEqual({
            threshold: 2,
        });
        // A constrained dimension the subject cannot answer matches nothing,
        // so the caller reports not_applicable rather than guessing.
        expect(indicator.parameterEntryFor("2026-08-01", { ...subject, method: null })).toBeNull();
        expect(indicator.parameterEntryFor("2026-08-01", { ...subject, method: "negotiated" })).toBeNull();
    });

    it("resolves no entry at a cutoff outside the timeline", () => {
        const indicator = makeIndicator({});
        const subject = { subjectKey: "cvpis:1", procurementSource: "cvpis", procurementId: "1" };
        expect(indicator.parameterEntryFor("2020-01-01", subject)).toBeNull();
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

    it("validates the rows a calculation returned against the output contract", async () => {
        const indicator = makeIndicator({}, [observation()]);
        await expect(indicator.evaluate(RUN, NO_DATA)).resolves.toEqual([observation()]);
    });

    it("rejects an observation carrying another indicator's identity", async () => {
        const indicator = makeIndicator({}, [observation({ indicatorVersion: 2 })]);
        await expect(indicator.evaluate(RUN, NO_DATA)).rejects.toThrow(/observation carries indicator identity/);
    });

    it("rejects an observation whose subjectType differs from the declared one", async () => {
        const indicator = makeIndicator({}, [observation({ subjectType: "lot" })]);
        await expect(indicator.evaluate(RUN, NO_DATA)).rejects.toThrow(/does not match the indicator's declared/);
    });

    it("rejects two observations about the same subject", async () => {
        const indicator = makeIndicator({}, [observation(), observation()]);
        await expect(indicator.evaluate(RUN, NO_DATA)).rejects.toThrow(/duplicate observation for subject/);
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
