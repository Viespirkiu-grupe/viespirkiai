import type { RiskIndicatorDefinition, RiskIndicatorKey } from "./types.ts";
import type { ARiskIndicatorDecision } from "./riskIndicatorDecision.ts";
import type { EvaluationContext } from "./evaluationContext.ts";

function keyString(key: RiskIndicatorKey): string {
    return `${key.id}/${key.version}`;
}

/**
 * A concrete indicator's decision.ts class — constructible from just an
 * EvaluationContext, with its RiskIndicatorDefinition exposed statically so
 * the registry can catalogue it without evaluating anything.
 */
export type IndicatorClass = (new (context: EvaluationContext) => ARiskIndicatorDecision) & {
    readonly definition: RiskIndicatorDefinition;
};

/**
 * The in-process catalogue of deployed Risk Indicator definitions, keyed by
 * (id, version). See docs/indicators-story/risk-service-architecture-v2.md §3.5.
 *
 * Holds definitions, not decisions: an ARiskIndicatorDecision is
 * evaluation-scoped (it carries a fixed EvaluationContext), so this registry
 * only ever hands one out via createAllIndicators(context) — never keeps one
 * around itself. The constructor throws on a duplicate key.
 */
export class RiskIndicatorRegistry {
    private readonly byKey = new Map<string, IndicatorClass>();

    constructor(indicatorClasses: readonly IndicatorClass[]) {
        for (const cls of indicatorClasses) {
            this.add(cls);
        }
    }

    require(key: RiskIndicatorKey): RiskIndicatorDefinition {
        const cls = this.byKey.get(keyString(key));
        if (!cls) {
            throw new Error(`Unknown Risk Indicator: ${keyString(key)}`);
        }
        return cls.definition;
    }

    all(): readonly RiskIndicatorDefinition[] {
        return [...this.byKey.values()].map((cls) => cls.definition);
    }

    /** One ARiskIndicatorDecision per registered definition carrying a parameter entry in force at context.dataAsOf. */
    createAllIndicators(context: EvaluationContext): readonly ARiskIndicatorDecision[] {
        return [...this.byKey.values()]
            .map((cls) => new cls(context))
            .filter((indicator) => indicator.parameterEntryFor(context.dataAsOf) !== null);
    }

    private add(cls: IndicatorClass): void {
        const ks = keyString(cls.definition.key);
        if (this.byKey.has(ks)) {
            throw new Error(`Duplicate Risk Indicator key: ${ks}`);
        }
        this.byKey.set(ks, cls);
    }
}
