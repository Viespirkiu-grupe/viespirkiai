import { describe, expect, it } from "vitest";
import { defineRiskIndicator, zodContract, type ParameterEntry, type RiskIndicator } from "../../modules/risk/contracts.ts";
import { createRiskIndicatorRegistry } from "../../modules/risk/registry.ts";
import { z } from "zod";

const paramsSchema = z.object({ threshold: z.number() });
const paramsContract = zodContract(paramsSchema);

function makeIndicator(overrides: {
    id?: string;
    version?: number;
    lifecycle?: "draft" | "shadow" | "active" | "retired";
    parameters?: readonly ParameterEntry<{ threshold: number }>[];
}): RiskIndicator<{ threshold: number }> {
    return defineRiskIndicator(
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
            calculation: async () => [],
            standard: { name: "test", url: "https://example.com" },
            public: {
                titleLt: "Testinis rodiklis",
                descriptionLt: "desc",
                formulaLt: "formula",
                limitationLt: "limitation",
            },
        },
        import.meta.url,
    );
}

describe("createRiskIndicatorRegistry", () => {
    it("rejects duplicate (id, version) keys", () => {
        const a = makeIndicator({});
        const b = makeIndicator({});
        expect(() => createRiskIndicatorRegistry([a, b])).toThrow(/Duplicate Risk Indicator key/);
    });

    it("rejects two active versions of the same indicator", () => {
        const v1 = makeIndicator({ version: 1, lifecycle: "active" });
        const v2 = makeIndicator({ version: 2, lifecycle: "active" });
        expect(() => createRiskIndicatorRegistry([v1, v2])).toThrow(/more than one active version/);
    });

    it("allows one active and one retired version of the same indicator", () => {
        const v1 = makeIndicator({ version: 1, lifecycle: "retired" });
        const v2 = makeIndicator({ version: 2, lifecycle: "active" });
        const registry = createRiskIndicatorRegistry([v1, v2]);
        expect(registry.activeVersions()).toEqual([{ id: "LT-TEST-01", version: 2 }]);
    });

    it("rejects a parameter timeline with a gap", () => {
        const indicator = makeIndicator({
            parameters: [
                { validFrom: "2026-01-01", validTo: "2026-06-01", scope: {}, values: { threshold: 1 }, source: "t" },
                { validFrom: "2026-07-01", validTo: null, scope: {}, values: { threshold: 2 }, source: "t" },
            ],
        });
        expect(() => createRiskIndicatorRegistry([indicator])).toThrow(/gap or overlap/);
    });

    it("rejects a parameter timeline with an overlap", () => {
        const indicator = makeIndicator({
            parameters: [
                { validFrom: "2026-01-01", validTo: "2026-07-01", scope: {}, values: { threshold: 1 }, source: "t" },
                { validFrom: "2026-06-01", validTo: null, scope: {}, values: { threshold: 2 }, source: "t" },
            ],
        });
        expect(() => createRiskIndicatorRegistry([indicator])).toThrow(/gap or overlap/);
    });

    it("rejects validTo earlier than validFrom", () => {
        const indicator = makeIndicator({
            parameters: [
                { validFrom: "2026-07-01", validTo: "2026-01-01", scope: {}, values: { threshold: 1 }, source: "t" },
            ],
        });
        expect(() => createRiskIndicatorRegistry([indicator])).toThrow(/earlier than validFrom/);
    });

    it("accepts a contiguous parameter timeline with no gap or overlap", () => {
        const indicator = makeIndicator({
            parameters: [
                { validFrom: "2026-01-01", validTo: "2026-07-01", scope: {}, values: { threshold: 1 }, source: "t" },
                { validFrom: "2026-07-01", validTo: null, scope: {}, values: { threshold: 2 }, source: "t" },
            ],
        });
        const registry = createRiskIndicatorRegistry([indicator]);
        expect(registry.parametersAsOf({ id: "LT-TEST-01", version: 1 }, "2026-08-01")).toEqual([
            indicator.parameters[1],
        ]);
        expect(registry.parametersAsOf({ id: "LT-TEST-01", version: 1 }, "2026-03-01")).toEqual([
            indicator.parameters[0],
        ]);
    });

    it("evaluableVersions includes active and shadow but not draft or retired", () => {
        const active = makeIndicator({ id: "LT-TEST-01", lifecycle: "active" });
        const shadow = makeIndicator({ id: "LT-TEST-02", lifecycle: "shadow" });
        const draft = makeIndicator({ id: "LT-TEST-03", lifecycle: "draft" });
        const retired = makeIndicator({ id: "LT-TEST-04", lifecycle: "retired" });
        const registry = createRiskIndicatorRegistry([active, shadow, draft, retired]);
        const evaluable = registry.evaluableVersions().map((k) => k.id);
        expect(evaluable.sort()).toEqual(["LT-TEST-01", "LT-TEST-02"]);
    });

    it("rejects a definition with empty public wording", () => {
        expect(() =>
            defineRiskIndicator(
                {
                    key: { id: "LT-TEST-05", version: 1 },
                    lifecycle: "active",
                    subjectType: "procurement",
                    stage: "tender",
                    references: [],
                    sourceRelations: [],
                    requiredInputs: [],
                    parameters: [],
                    parameterContract: paramsContract,
                    calculation: async () => [],
                    standard: { name: "test", url: "https://example.com" },
                    public: { titleLt: "", descriptionLt: "d", formulaLt: "f", limitationLt: "l" },
                },
                import.meta.url,
            ),
        ).toThrow(/titleLt and public.limitationLt must be non-empty/);
    });
});
