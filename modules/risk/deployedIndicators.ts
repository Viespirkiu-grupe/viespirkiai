import type { RiskIndicator } from "./riskIndicator.ts";
import { RiskIndicatorRegistry } from "./registry.ts";
import { ltCom01v1 } from "./indicators/LT-COM-01/definition.ts";

// Explicit registration, reviewable in a pull request — see
// risk-service-architecture.md §4.3.
const deployedIndicators = [ltCom01v1] as const satisfies readonly RiskIndicator<unknown>[];

export const riskIndicatorRegistry = new RiskIndicatorRegistry(deployedIndicators);
