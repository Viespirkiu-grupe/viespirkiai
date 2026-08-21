import type { ARiskIndicatorDecision } from "./riskIndicatorDecision.ts";
import { RiskIndicatorRegistry } from "./registry.ts";
import { ltCom01v1 } from "./indicators/LT-COM-01/decision.ts";
import { ltCom02v1 } from "./indicators/LT-COM-02/decision.ts";
import { ltCom03v1 } from "./indicators/LT-COM-03/decision.ts";

// See docs/indicators-story/risk-service-architecture.md §4.3.
const deployedIndicators = [ltCom01v1, ltCom02v1, ltCom03v1] as const satisfies readonly ARiskIndicatorDecision[];

export const riskIndicatorRegistry = new RiskIndicatorRegistry(deployedIndicators);

// A projection of riskIndicatorRegistry.all() over the fields listed in
// riskCatalogueFields below. See
// docs/indicators-story/risk-service-architecture.md §3.3.
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

/** The field set riskCatalogue entries publish, in order. */
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
