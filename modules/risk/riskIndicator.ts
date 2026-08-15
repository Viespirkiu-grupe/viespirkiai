import type { z } from "zod";
import {
    riskObservationV1Contract,
    zodContract,
    type IndicatorLifecycle,
    type IndicatorStage,
    type ParameterEntry,
    type RiskIndicatorKey,
    type RiskObservationV1,
    type RuntimeContract,
    type SubjectFacts,
    type SubjectType,
} from "./contracts.ts";
import { EvaluationContext, type EvaluationRun } from "./evaluationContext.ts";
import { describeScope, scopeAdmits, scopeKey, scopesAreDisjoint } from "./parameterScope.ts";
import type { RiskDataSource } from "./riskDataSource.ts";

// One deployed Risk Indicator version: validates itself, resolves its own
// effective parameters, calculates, and validates what it produced. See
// docs/indicators-story/risk-service-architecture.md §4.3.
//
// `calculate` is abstract; SubjectFactsIndicator (subjectFactsIndicator.ts)
// is the common "collect facts in SQL, decide in TypeScript" implementation.

// Half-open validity ranges [validFrom, validTo), where a null validTo is
// "still in force".
function overlapInTime(a: ParameterEntry<unknown>, b: ParameterEntry<unknown>): boolean {
    const aEndsAfterBStarts = a.validTo === null || a.validTo > b.validFrom;
    const bEndsAfterAStarts = b.validTo === null || b.validTo > a.validFrom;
    return aEndsAfterBStarts && bEndsAfterAStarts;
}

export type RiskIndicatorStandard = Readonly<{
    name: string;
    url: string;
    page?: number;
}>;

export type RiskIndicatorPublicText = Readonly<{
    titleLt: string;
    descriptionLt: string;
    formulaLt: string;
    limitationLt: string;
}>;

// The metadata of one indicator version, passed to the constructor and
// validated there.
export type RiskIndicatorDefinition<P> = Readonly<{
    key: RiskIndicatorKey;
    lifecycle: IndicatorLifecycle;
    subjectType: SubjectType;
    stage: IndicatorStage;
    references: readonly string[];
    sourceRelations: readonly string[];
    requiredInputs: readonly string[];
    parameters: readonly ParameterEntry<P>[];
    // The shape and value constraints one entry's `values` must satisfy;
    // zodContract() wraps it into parameterContract below.
    parameterSchema: z.ZodType<P>;
    outputContract?: RuntimeContract<RiskObservationV1>;
    standard: RiskIndicatorStandard;
    public: RiskIndicatorPublicText;
}>;

export abstract class RiskIndicator<P = unknown> {
    readonly key: RiskIndicatorKey;
    readonly lifecycle: IndicatorLifecycle;
    readonly subjectType: SubjectType;
    readonly stage: IndicatorStage;
    readonly references: readonly string[];
    readonly sourceRelations: readonly string[];
    readonly requiredInputs: readonly string[];
    readonly parameters: readonly ParameterEntry<P>[];
    private readonly parameterContract: RuntimeContract<P>;
    readonly outputContract: RuntimeContract<RiskObservationV1>;
    readonly standard: RiskIndicatorStandard;
    readonly public: RiskIndicatorPublicText;

    /**
     * Throws on an id outside the catalogue namespace, missing public
     * wording, parameter values that violate the indicator's own contract,
     * or a gapped/overlapping parameter timeline. See
     * docs/indicators-story/risk-service-architecture.md §4.3.
     */
    protected constructor(definition: RiskIndicatorDefinition<P>) {
        this.key = definition.key;
        this.lifecycle = definition.lifecycle;
        this.subjectType = definition.subjectType;
        this.stage = definition.stage;
        this.references = definition.references;
        this.sourceRelations = definition.sourceRelations;
        this.requiredInputs = definition.requiredInputs;
        this.parameters = definition.parameters;
        this.parameterContract = zodContract(definition.parameterSchema);
        this.outputContract = definition.outputContract ?? riskObservationV1Contract;
        this.standard = definition.standard;
        this.public = definition.public;

        this.assertIdentity();
        this.assertPublicWording();
        this.assertParameterTimeline();
    }

    get id(): RiskIndicatorKey["id"] {
        return this.key.id;
    }

    get version(): number {
        return this.key.version;
    }

    get isActive(): boolean {
        return this.lifecycle === "active";
    }

    // True when lifecycle is 'active' or 'shadow'. See
    // docs/indicators-story/risk-service-architecture.md §7.1.
    get isEvaluable(): boolean {
        return this.lifecycle === "active" || this.lifecycle === "shadow";
    }

    /** Catalogue identity as one string, e.g. `LT-COM-01/1`. */
    toString(): string {
        return `${this.key.id}/${this.key.version}`;
    }

    /** The parameter entries in force at a cutoff, across all scopes. */
    parametersAsOf(dataAsOf: string): readonly ParameterEntry<P>[] {
        return this.parameters.filter(
            (entry) => entry.validFrom <= dataAsOf && (entry.validTo === null || entry.validTo > dataAsOf),
        );
    }

    /**
     * The one entry that decides a subject at a cutoff: in force by date, and
     * scoped to admit these facts. `null` means no parameter entry covers
     * this subject. See
     * docs/indicators-story/risk-service-architecture.md §4.5.
     *
     * assertParameterTimeline (below) rejects concurrently valid entries with
     * overlapping scopes, so at most one entry can match.
     */
    parameterEntryFor(dataAsOf: string, facts: SubjectFacts): ParameterEntry<P> | null {
        return this.parametersAsOf(dataAsOf).find((entry) => scopeAdmits(entry.scope, facts)) ?? null;
    }

    /**
     * Resolves this indicator's effective parameters for the run's cutoff,
     * calls calculate(), and validates the result via validateObservations().
     */
    async evaluate(run: EvaluationRun, data: RiskDataSource): Promise<readonly RiskObservationV1[]> {
        const context = new EvaluationContext(run, this.parametersAsOf(run.dataAsOf));
        return this.validateObservations(await this.calculate(context, data));
    }

    /**
     * Produces this indicator's observation rows for one cutoff, reading
     * canonical facts through `data`. Called only from evaluate() above,
     * which validates the result. See
     * docs/indicators-story/risk-service-architecture.md §4.4.
     */
    protected abstract calculate(
        context: EvaluationContext,
        data: RiskDataSource,
    ): Promise<readonly RiskObservationV1[]>;

    /**
     * Validates rows against the output contract, then checks that each
     * row's indicatorId/indicatorVersion match this indicator's key and that
     * no (subjectType, subjectKey) pair repeats within the batch. See
     * docs/indicators-story/risk-schema.md §2.
     */
    validateObservations(observations: readonly unknown[]): readonly RiskObservationV1[] {
        const seen = new Set<string>();
        const validated: RiskObservationV1[] = [];

        for (const raw of observations) {
            const observation = this.outputContract.validate(raw);

            if (observation.indicatorId !== this.key.id || observation.indicatorVersion !== this.key.version) {
                throw new Error(
                    `${this.key.id}: observation carries indicator identity ${observation.indicatorId}/${observation.indicatorVersion}, expected ${this}`,
                );
            }
            if (observation.subjectType !== this.subjectType) {
                throw new Error(
                    `${this.key.id}: observation subjectType ${observation.subjectType} does not match the indicator's declared subjectType ${this.subjectType}`,
                );
            }

            const dedupeKey = `${observation.subjectType}:${observation.subjectKey}`;
            if (seen.has(dedupeKey)) {
                throw new Error(`${this.key.id}: duplicate observation for subject ${dedupeKey}`);
            }
            seen.add(dedupeKey);

            validated.push(observation);
        }

        return validated;
    }

    private assertIdentity(): void {
        if (!this.key.id.startsWith("LT-")) {
            throw new Error(`Risk Indicator id must start with 'LT-': ${this.key.id}`);
        }
    }

    private assertPublicWording(): void {
        if (!this.public.titleLt || !this.public.limitationLt) {
            throw new Error(
                `Risk Indicator ${this.key.id}: public.titleLt and public.limitationLt must be non-empty`,
            );
        }
    }

    /**
     * Calls assertContiguousWithinScope and assertDisjointWhereConcurrent
     * (below) on the sorted parameter entries. See
     * docs/indicators-story/risk-service-architecture.md §7.3, §4.5.
     */
    private assertParameterTimeline(): void {
        const entries = [...this.parameters].sort((a, b) => a.validFrom.localeCompare(b.validFrom));

        for (const entry of entries) {
            this.parameterContract.validate(entry.values);
            if (entry.validTo !== null && entry.validTo < entry.validFrom) {
                throw new Error(
                    `Risk Indicator ${this.key.id}: parameter entry validTo (${entry.validTo}) is earlier than validFrom (${entry.validFrom})`,
                );
            }
        }

        this.assertContiguousWithinScope(entries);
        this.assertDisjointWhereConcurrent(entries);
    }

    private assertContiguousWithinScope(sortedEntries: readonly ParameterEntry<P>[]): void {
        const byScope = new Map<string, ParameterEntry<P>[]>();
        for (const entry of sortedEntries) {
            const key = scopeKey(entry.scope);
            byScope.set(key, [...(byScope.get(key) ?? []), entry]);
        }

        for (const group of byScope.values()) {
            for (let i = 0; i < group.length - 1; i++) {
                const current = group[i];
                const next = group[i + 1];
                const scope = describeScope(current.scope);

                if (current.validTo === null) {
                    throw new Error(
                        `Risk Indicator ${this.key.id}: parameter entry starting ${current.validFrom} (${scope}) is open-ended but is followed by another entry starting ${next.validFrom}`,
                    );
                }
                if (current.validTo !== next.validFrom) {
                    throw new Error(
                        `Risk Indicator ${this.key.id}: parameter entries for ${scope} have a gap or overlap between ${current.validTo} and ${next.validFrom}`,
                    );
                }
            }
        }
    }

    private assertDisjointWhereConcurrent(sortedEntries: readonly ParameterEntry<P>[]): void {
        for (let i = 0; i < sortedEntries.length; i++) {
            for (let j = i + 1; j < sortedEntries.length; j++) {
                const a = sortedEntries[i];
                const b = sortedEntries[j];
                if (scopeKey(a.scope) === scopeKey(b.scope)) continue; // handled as one timeline
                if (!overlapInTime(a, b)) continue;
                if (scopesAreDisjoint(a.scope, b.scope)) continue;

                throw new Error(
                    `Risk Indicator ${this.key.id}: parameter entries starting ${a.validFrom} (${describeScope(a.scope)}) and ${b.validFrom} (${describeScope(b.scope)}) are valid at the same time with overlapping scopes, so a subject could match both`,
                );
            }
        }
    }
}
