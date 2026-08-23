import type { IndicatorClass } from "./registry.ts";
import { RiskIndicatorRegistry } from "./registry.ts";
import { LtCom01Decision } from "./indicators/LT-COM-01/decision.ts";
import { LtCom02Decision } from "./indicators/LT-COM-02/decision.ts";
import { LtCom03Decision } from "./indicators/LT-COM-03/decision.ts";
import { LtCom20Decision } from "./indicators/LT-COM-20/decision.ts";

// See docs/indicators-story/risk-service-architecture-v2.md §3.5.
const deployedIndicatorClasses = [
    LtCom01Decision,
    LtCom02Decision,
    LtCom03Decision,
    LtCom20Decision,
] as const satisfies readonly IndicatorClass[];

export const riskIndicatorRegistry = new RiskIndicatorRegistry(deployedIndicatorClasses);

// A projection of riskIndicatorRegistry.all() over the fields listed in
// riskCatalogueFields below. See
// docs/indicators-story/risk-service-architecture-v2.md §3.5.
export const riskCatalogue = riskIndicatorRegistry.all().map((definition) => ({
    id: definition.key.id,
    version: definition.key.version,
    stage: definition.stage,
    subjectType: definition.subjectType,
    references: definition.references,
    standard: definition.standard,
    public: definition.public,
    parameters: definition.parameters,
}));

/** The field set riskCatalogue entries publish, in order. */
export const riskCatalogueFields = [
    "id",
    "version",
    "stage",
    "subjectType",
    "references",
    "standard",
    "public",
    "parameters",
] as const;

export type RiskCatalogueEntry = (typeof riskCatalogue)[number];
