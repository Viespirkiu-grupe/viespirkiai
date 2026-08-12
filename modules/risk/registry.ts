import type { RiskIndicatorKey } from "./contracts.ts";
import type { RiskIndicator } from "./riskIndicator.ts";

function keyString(key: RiskIndicatorKey): string {
    return `${key.id}/${key.version}`;
}

/**
 * The immutable, explicitly constructed in-process catalogue of every
 * deployed Risk Indicator version (risk-service-architecture.md §5.2). Keyed
 * by (indicator_id, implementation_version); given that key the run job
 * retrieves exactly one definition.
 *
 * Each indicator validates itself when it is constructed, so what is left for
 * the registry is what only a *set* of indicators can be wrong about:
 * duplicate keys and a second active version of the same indicator. Both
 * throw here, at import time.
 */
export class RiskIndicatorRegistry {
    private readonly byKey = new Map<string, RiskIndicator<unknown>>();
    private readonly activeById = new Map<string, RiskIndicator<unknown>>();

    constructor(indicators: readonly RiskIndicator<unknown>[]) {
        for (const indicator of indicators) {
            this.add(indicator);
        }
    }

    require(key: RiskIndicatorKey): RiskIndicator<unknown> {
        const indicator = this.byKey.get(keyString(key));
        if (!indicator) {
            throw new Error(`Unknown Risk Indicator: ${keyString(key)}`);
        }
        return indicator;
    }

    all(): readonly RiskIndicator<unknown>[] {
        return [...this.byKey.values()];
    }

    /** The one `active` version of each indicator — what the read model shows. */
    active(): readonly RiskIndicator<unknown>[] {
        return [...this.activeById.values()];
    }

    /** `active` + `shadow`: what a run evaluates and writes (see RiskIndicator.isEvaluable). */
    evaluable(): readonly RiskIndicator<unknown>[] {
        return this.all().filter((indicator) => indicator.isEvaluable);
    }

    private add(indicator: RiskIndicator<unknown>): void {
        const ks = keyString(indicator.key);
        if (this.byKey.has(ks)) {
            throw new Error(`Duplicate Risk Indicator key: ${ks}`);
        }
        this.byKey.set(ks, indicator);

        if (!indicator.isActive) return;

        const existingActive = this.activeById.get(indicator.id);
        if (existingActive) {
            throw new Error(
                `Risk Indicator ${indicator.id} has more than one active version: ${existingActive.version} and ${indicator.version}`,
            );
        }
        this.activeById.set(indicator.id, indicator);
    }
}
