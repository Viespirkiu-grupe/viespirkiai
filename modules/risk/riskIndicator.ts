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

// One deployed Risk Indicator version, as an object that knows how to check
// itself, resolve its own effective parameters, calculate, and validate what
// it produced (risk-service-architecture.md §4.3).
//
// The base class owns everything every indicator shares; the one thing that
// differs between indicators — how the observations are produced — is the
// abstract `calculate`. The common "collect facts in SQL, decide in
// TypeScript" case is SubjectFactsIndicator; an indicator whose collection step
// cannot produce one row per subject subclasses this directly in its own
// directory, implementing `calculate` itself, and is free to run several
// packaged statements and assemble the rows.

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

// WHAT IT IS: the reviewable metadata of one indicator version, with no
// behaviour of its own. Passed to the constructor, validated there.
export type RiskIndicatorDefinition<P> = Readonly<{
    key: RiskIndicatorKey;
    lifecycle: IndicatorLifecycle;
    subjectType: SubjectType;
    stage: IndicatorStage;
    references: readonly string[];
    sourceRelations: readonly string[];
    requiredInputs: readonly string[];
    parameters: readonly ParameterEntry<P>[];
    // The shape and value constraints one entry's `values` must satisfy. A
    // plain schema, so an indicator directory declares what a valid parameter
    // is and never constructs a contract; the base class does that below.
    // Only the constraints TypeScript cannot state — `.int()`, `.positive()`,
    // `.min()` — earn their keep here: the entries are git-maintained literals
    // typed as ParameterEntry<P>, so the compiler already rejects a wrong
    // shape. A schema with no such refinement is ceremony.
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
     * Startup runtime checks (§4.3): an id outside the catalogue namespace,
     * missing public wording, parameter values that violate the indicator's
     * own contract, or a gapped/overlapping parameter timeline all fail here,
     * at import time, rather than in the middle of a run.
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

    // 'active' + 'shadow': what the run job actually evaluates and writes.
    // A shadow version is computed like any other — §7.1 defines it as
    // "evaluated and written, excluded from the public read model", so the
    // numbers exist and excluding them is a web-layer concern. 'draft' isn't
    // ready to run yet; 'retired' has stopped producing new signals.
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
     * scoped to admit these facts (§4.5). `null` means no reviewed threshold
     * covers this subject, which the caller reports as `not_applicable` —
     * never as a decision computed without parameters.
     *
     * The result is unambiguous because `assertParameterTimeline` rejects
     * concurrently valid entries with overlapping scopes at startup.
     */
    parameterEntryFor(dataAsOf: string, facts: SubjectFacts): ParameterEntry<P> | null {
        return this.parametersAsOf(dataAsOf).find((entry) => scopeAdmits(entry.scope, facts)) ?? null;
    }

    /**
     * The one call the run job and the tests make: resolve this indicator's
     * effective parameters for the run's cutoff, calculate against the given
     * data source, and validate the rows before anyone sees them. Nobody
     * outside can calculate without validating, or with another indicator's
     * parameters.
     */
    async evaluate(run: EvaluationRun, data: RiskDataSource): Promise<readonly RiskObservationV1[]> {
        const context = new EvaluationContext(run, this.parametersAsOf(run.dataAsOf));
        return this.validateObservations(await this.calculate(context, data));
    }

    /**
     * HOW IT CALCULATES. Produces the standard observation rows for this
     * indicator at one cutoff, reading canonical facts through `data`
     * (§4.4). Called only through `evaluate`, which validates the result.
     */
    protected abstract calculate(
        context: EvaluationContext,
        data: RiskDataSource,
    ): Promise<readonly RiskObservationV1[]>;

    /**
     * Validates rows against the output contract plus the cross-row
     * invariants §8 lists: subject and indicator identity, and no duplicate
     * (subjectType, subjectKey) within one indicator's batch — that pair is
     * the current-state unique index (risk-schema.md §2), so a duplicate here
     * would collide at write time.
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
     * The timeline is append-only, contiguous *within a scope*, and
     * unambiguous *across scopes* (§7.3, §4.5). One indicator version may
     * carry a different threshold per procedure type — that is several
     * entries valid at once, distinguished by `scope` — so contiguity is
     * checked per scope, and what makes resolution deterministic is instead
     * that concurrently valid scopes never admit the same subject.
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
