import { describe, expect, it } from "vitest";
import {
    riskCatalogue,
    riskCatalogueFields,
    riskIndicatorRegistry,
} from "../../modules/risk/deployedIndicators.ts";

// The methodology page (risk-service-architecture.md §3.3) imports
// `riskCatalogue` and renders it as-is, so what these tests protect is the
// boundary: every deployed version is described, and nothing beyond the
// published fields travels to the web layer.
describe("riskCatalogue", () => {
    it("describes every deployed indicator version, whatever its lifecycle", () => {
        expect(riskCatalogue.map((entry) => `${entry.id}/${entry.version}`)).toEqual(
            riskIndicatorRegistry.all().map((indicator) => indicator.toString()),
        );
    });

    // A field added to RiskIndicatorDefinition must be published deliberately,
    // by naming it in riskCatalogueFields, rather than by leaking through.
    it("publishes exactly the fields declared as public", () => {
        for (const entry of riskCatalogue) {
            expect(Object.keys(entry).sort()).toEqual([...riskCatalogueFields].sort());
        }
    });

    it("keeps the collection internals out of the entries", () => {
        const internals = [
            "sourceRelations",
            "requiredInputs",
            "sqlFile",
            "parameterSchema",
            "parameterContract",
            "outputContract",
            "decide",
            "key",
        ];
        for (const entry of riskCatalogue) {
            for (const field of internals) {
                expect(entry).not.toHaveProperty(field);
            }
        }
    });

    it("carries the public wording and parameter history each entry is rendered from", () => {
        for (const entry of riskCatalogue) {
            expect(entry.public.titleLt).not.toBe("");
            expect(entry.public.limitationLt).not.toBe("");
            expect(entry.standard.url).toMatch(/^https:\/\//);
            expect(entry.parameters.length).toBeGreaterThan(0);
        }
    });
});
