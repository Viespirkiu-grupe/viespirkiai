import type { ParameterEntry, RiskIndicator, RiskIndicatorKey } from "./contracts.ts";

function keyString(key: RiskIndicatorKey): string {
    return `${key.id}/${key.version}`;
}

function validateParameterTimeline(indicator: RiskIndicator<unknown>): void {
    const entries = [...indicator.parameters].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    for (const entry of entries) {
        if (entry.validTo !== null && entry.validTo < entry.validFrom) {
            throw new Error(
                `Risk Indicator ${indicator.key.id}: parameter entry validTo (${entry.validTo}) is earlier than validFrom (${entry.validFrom})`,
            );
        }
    }
    for (let i = 0; i < entries.length - 1; i++) {
        const current = entries[i];
        const next = entries[i + 1];
        if (current.validTo === null) {
            throw new Error(
                `Risk Indicator ${indicator.key.id}: parameter entry starting ${current.validFrom} is open-ended but is followed by another entry starting ${next.validFrom}`,
            );
        }
        if (current.validTo !== next.validFrom) {
            throw new Error(
                `Risk Indicator ${indicator.key.id}: parameter entries have a gap or overlap between ${current.validTo} and ${next.validFrom}`,
            );
        }
    }
}

export type RiskIndicatorRegistry = Readonly<{
    require(key: RiskIndicatorKey): RiskIndicator<unknown>;
    activeVersions(): readonly RiskIndicatorKey[];
    // 'active' + 'shadow': what the run job actually evaluates and writes.
    // Shadow versions are computed like any other — §10.3: "merging it as
    // lifecycle: 'shadow' first keeps the version out of the read model
    // until a later commit flips it to 'active'" implies the numbers exist,
    // they're just excluded from the public read model (a web-layer
    // concern, out of scope for this run job). 'draft' isn't ready to run
    // yet; 'retired' has stopped producing new signals (§10.4).
    evaluableVersions(): readonly RiskIndicatorKey[];
    parametersAsOf(key: RiskIndicatorKey, dataAsOf: string): readonly ParameterEntry<unknown>[];
    all(): readonly RiskIndicator<unknown>[];
}>;

/**
 * Validates a set of deployed Risk Indicator definitions and builds the
 * immutable, explicitly constructed in-process catalogue described in
 * risk-service-architecture.md §5.2. Throws on: duplicate (id, version)
 * keys, more than one active version per id, or a gapped/overlapping
 * parameter timeline.
 */
export function createRiskIndicatorRegistry(
    indicators: readonly RiskIndicator<unknown>[],
): RiskIndicatorRegistry {
    const byKey = new Map<string, RiskIndicator<unknown>>();
    const activeByIndicatorId = new Map<string, RiskIndicatorKey>();

    for (const indicator of indicators) {
        const ks = keyString(indicator.key);
        if (byKey.has(ks)) {
            throw new Error(`Duplicate Risk Indicator key: ${ks}`);
        }
        byKey.set(ks, indicator);

        if (indicator.lifecycle === "active") {
            const existingActive = activeByIndicatorId.get(indicator.key.id);
            if (existingActive) {
                throw new Error(
                    `Risk Indicator ${indicator.key.id} has more than one active version: ${existingActive.version} and ${indicator.key.version}`,
                );
            }
            activeByIndicatorId.set(indicator.key.id, indicator.key);
        }

        validateParameterTimeline(indicator);
    }

    return Object.freeze({
        require(key: RiskIndicatorKey): RiskIndicator<unknown> {
            const indicator = byKey.get(keyString(key));
            if (!indicator) {
                throw new Error(`Unknown Risk Indicator: ${keyString(key)}`);
            }
            return indicator;
        },

        activeVersions(): readonly RiskIndicatorKey[] {
            return [...activeByIndicatorId.values()];
        },

        evaluableVersions(): readonly RiskIndicatorKey[] {
            return indicators
                .filter((indicator) => indicator.lifecycle === "active" || indicator.lifecycle === "shadow")
                .map((indicator) => indicator.key);
        },

        parametersAsOf(key: RiskIndicatorKey, dataAsOf: string): readonly ParameterEntry<unknown>[] {
            const indicator = this.require(key);
            return indicator.parameters.filter(
                (entry) => entry.validFrom <= dataAsOf && (entry.validTo === null || entry.validTo > dataAsOf),
            );
        },

        all(): readonly RiskIndicator<unknown>[] {
            return [...byKey.values()];
        },
    });
}
