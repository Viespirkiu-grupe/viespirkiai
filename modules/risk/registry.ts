import type { RiskIndicatorKey } from "./types.ts";
import type { ARiskIndicatorDecision } from "./riskIndicatorDecision.ts";

function keyString(key: RiskIndicatorKey): string {
    return `${key.id}/${key.version}`;
}

/**
 * The in-process catalogue of deployed Risk Indicator versions, keyed by
 * (id, version). See docs/indicators-story/risk-service-architecture-v2.md §3.5.
 *
 * The constructor throws on a duplicate key or on more than one active
 * version of the same indicator id.
 */
export class RiskIndicatorRegistry {
    private readonly byKey = new Map<string, ARiskIndicatorDecision>();
    private readonly activeById = new Map<string, ARiskIndicatorDecision>();

    constructor(indicators: readonly ARiskIndicatorDecision[]) {
        for (const indicator of indicators) {
            this.add(indicator);
        }
    }

    require(key: RiskIndicatorKey): ARiskIndicatorDecision {
        const indicator = this.byKey.get(keyString(key));
        if (!indicator) {
            throw new Error(`Unknown Risk Indicator: ${keyString(key)}`);
        }
        return indicator;
    }

    all(): readonly ARiskIndicatorDecision[] {
        return [...this.byKey.values()];
    }

    /** The one `active`-lifecycle version of each indicator. */
    active(): readonly ARiskIndicatorDecision[] {
        return [...this.activeById.values()];
    }

    /** Indicators whose lifecycle is 'active' or 'shadow'; see ARiskIndicatorDecision.isEvaluable in riskIndicatorDecision.ts. */
    evaluable(): readonly ARiskIndicatorDecision[] {
        return this.all().filter((indicator) => indicator.isEvaluable);
    }

    private add(indicator: ARiskIndicatorDecision): void {
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
