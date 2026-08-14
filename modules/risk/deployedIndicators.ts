import type { RiskIndicator } from "./riskIndicator.ts";
import { RiskIndicatorRegistry } from "./registry.ts";
import { ltCom01v1 } from "./indicators/LT-COM-01/definition.ts";
import { ltCom02v1 } from "./indicators/LT-COM-02/definition.ts";
import { ltCom03v1 } from "./indicators/LT-COM-03/definition.ts";

// Explicit registration, reviewable in a pull request — see
// risk-service-architecture.md §4.3.
const deployedIndicators = [ltCom01v1, ltCom02v1, ltCom03v1] as const satisfies readonly RiskIndicator<unknown>[];

export const riskIndicatorRegistry = new RiskIndicatorRegistry(deployedIndicators);

// The public metadata of every deployed version, as one constant the Astro
// methodology page imports directly (§3.3). The registry is built and validated
// at import time, so this is a plain projection over it: no artefact on disk,
// nothing to regenerate, and no second copy that can describe an indicator
// differently from the way the service executes it.
//
// The internals stay behind this boundary on purpose — sourceRelations,
// requiredInputs, sqlFile, parameterSchema and decide are absent, and
// riskCatalogueFields below is what keeps them absent.
export const riskCatalogue = riskIndicatorRegistry.all().map((indicator) => ({
    id: indicator.key.id,
    version: indicator.key.version,
    lifecycle: indicator.lifecycle,
    stage: indicator.stage,
    subjectType: indicator.subjectType,
    references: indicator.references,
    standard: indicator.standard,
    public: indicator.public,
    parameters: indicator.parameters,
}));

/** Exactly the fields a catalogue entry publishes; asserted in the tests. */
export const riskCatalogueFields = [
    "id",
    "version",
    "lifecycle",
    "stage",
    "subjectType",
    "references",
    "standard",
    "public",
    "parameters",
] as const;

export type RiskCatalogueEntry = (typeof riskCatalogue)[number];
