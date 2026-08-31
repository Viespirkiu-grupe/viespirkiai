import type { IndicatorClass } from "./registry.ts";
import { RiskIndicatorRegistry } from "./registry.ts";
import { LtAwd01Decision } from "./indicators/LT-AWD-01/decision.ts";
import { LtAwd02Decision } from "./indicators/LT-AWD-02/decision.ts";
import { LtAwd03Decision } from "./indicators/LT-AWD-03/decision.ts";
import { LtAwd04Decision } from "./indicators/LT-AWD-04/decision.ts";
import { LtCom01Decision } from "./indicators/LT-COM-01/decision.ts";
import { LtCom02Decision } from "./indicators/LT-COM-02/decision.ts";
import { LtCom03Decision } from "./indicators/LT-COM-03/decision.ts";
import { LtCom10Decision } from "./indicators/LT-COM-10/decision.ts";
import { LtCom11Decision } from "./indicators/LT-COM-11/decision.ts";
import { LtCom12Decision } from "./indicators/LT-COM-12/decision.ts";
import { LtCom13Decision } from "./indicators/LT-COM-13/decision.ts";
import { LtCom20Decision } from "./indicators/LT-COM-20/decision.ts";
import { LtCom21Decision } from "./indicators/LT-COM-21/decision.ts";
import { LtOth03Decision } from "./indicators/LT-OTH-03/decision.ts";
import { LtOth04Decision } from "./indicators/LT-OTH-04/decision.ts";
import { LtOth05Decision } from "./indicators/LT-OTH-05/decision.ts";
import { LtPri05Decision } from "./indicators/LT-PRI-05/decision.ts";
import { LtPri06Decision } from "./indicators/LT-PRI-06/decision.ts";
import { LtPro01Decision } from "./indicators/LT-PRO-01/decision.ts";
import { LtPro05Decision } from "./indicators/LT-PRO-05/decision.ts";
import { LtPro08Decision } from "./indicators/LT-PRO-08/decision.ts";
import { LtTra06Decision } from "./indicators/LT-TRA-06/decision.ts";
import { LtTra07Decision } from "./indicators/LT-TRA-07/decision.ts";
import { LtTra08Decision } from "./indicators/LT-TRA-08/decision.ts";
import { LtTra09Decision } from "./indicators/LT-TRA-09/decision.ts";

// See docs/indicators-story/risk-service-architecture-v2.md §3.5.
const deployedIndicatorClasses = [
    LtAwd01Decision,
    LtAwd02Decision,
    LtAwd03Decision,
    LtAwd04Decision,
    LtCom01Decision,
    LtCom02Decision,
    LtCom03Decision,
    LtCom10Decision,
    LtCom11Decision,
    LtCom12Decision,
    LtCom13Decision,
    LtCom20Decision,
    LtCom21Decision,
    LtOth03Decision,
    LtOth04Decision,
    LtOth05Decision,
    LtPri05Decision,
    LtPri06Decision,
    LtPro01Decision,
    LtPro05Decision,
    LtPro08Decision,
    LtTra06Decision,
    LtTra07Decision,
    LtTra08Decision,
    LtTra09Decision,
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
