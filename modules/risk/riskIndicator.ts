import {
    riskObservationV1Contract,
    type IndicatorLifecycle,
    type IndicatorStage,
    type ParameterEntry,
    type RiskIndicatorKey,
    type RiskObservationV1,
    type RuntimeContract,
    type SubjectType,
} from "./contracts.ts";
import { EvaluationContext, type EvaluationRun } from "./evaluationContext.ts";
import type { RiskDataSource } from "./riskDataSource.ts";

// One deployed Risk Indicator version, as an object that knows how to check
// itself, resolve its own effective parameters, calculate, and validate what
// it produced (risk-service-architecture.md §5.2).
//
// The base class owns everything every indicator shares; the one thing that
// differs between indicators — how the observations are produced — is the
// abstract `calculate`. The common "one packaged SELECT" case is
// SqlRiskIndicator; an indicator with an internal shape subclasses this
// directly in its own directory (the doc's `calculate.ts` case) and is free
// to run several packaged statements and assemble the rows itself.

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
    parameterContract: RuntimeContract<P>;
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
    readonly parameterContract: RuntimeContract<P>;
    readonly outputContract: RuntimeContract<RiskObservationV1>;
    readonly standard: RiskIndicatorStandard;
    readonly public: RiskIndicatorPublicText;

    /**
     * Startup runtime checks (§5.2): an id outside the catalogue namespace,
     * missing public wording, parameter values that violate the indicator's
     * own contract, or a gapped/overlapping parameter timeline all fail here,
     * at import time, rather than in the middle of a run.
     */
    constructor(definition: RiskIndicatorDefinition<P>) {
        this.key = definition.key;
        this.lifecycle = definition.lifecycle;
        this.subjectType = definition.subjectType;
        this.stage = definition.stage;
        this.references = definition.references;
        this.sourceRelations = definition.sourceRelations;
        this.requiredInputs = definition.requiredInputs;
        this.parameters = definition.parameters;
        this.parameterContract = definition.parameterContract;
        this.outputContract = definition.outputContract ?? riskObservationV1Contract;
        this.standard = definition.standard;
        this.public = definition.public;

        this.#assertIdentity();
        this.#assertPublicWording();
        this.#assertParameterTimeline();
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
    // Shadow versions are computed like any other — §10.3: "merging it as
    // lifecycle: 'shadow' first keeps the version out of the read model
    // until a later commit flips it to 'active'" implies the numbers exist,
    // they're just excluded from the public read model (a web-layer
    // concern). 'draft' isn't ready to run yet; 'retired' has stopped
    // producing new signals (§10.4).
    get isEvaluable(): boolean {
        return this.lifecycle === "active" || this.lifecycle === "shadow";
    }

    /** Catalogue identity as one string, e.g. `LT-COM-01/1`. */
    toString(): string {
        return `${this.key.id}/${this.key.version}`;
    }

    /** The parameter entries in force at a cutoff — the run's `$3`. */
    parametersAsOf(dataAsOf: string): readonly ParameterEntry<P>[] {
        return this.parameters.filter(
            (entry) => entry.validFrom <= dataAsOf && (entry.validTo === null || entry.validTo > dataAsOf),
        );
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
     * (§5.3.1). Called only through `evaluate`, which validates the result.
     */
    protected abstract calculate(
        context: EvaluationContext,
        data: RiskDataSource,
    ): Promise<readonly RiskObservationV1[]>;

    /**
     * Validates rows against the output contract plus the cross-row
     * invariants §11 lists: subject and indicator identity, and no duplicate
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

    #assertIdentity(): void {
        if (!this.key.id.startsWith("LT-")) {
            throw new Error(`Risk Indicator id must start with 'LT-': ${this.key.id}`);
        }
    }

    #assertPublicWording(): void {
        if (!this.public.titleLt || !this.public.limitationLt) {
            throw new Error(
                `Risk Indicator ${this.key.id}: public.titleLt and public.limitationLt must be non-empty`,
            );
        }
    }

    // The timeline is append-only and contiguous: every cutoff resolves to at
    // most one entry, so a gap, an overlap or a backwards range is a
    // definition bug (§10.2).
    #assertParameterTimeline(): void {
        const entries = [...this.parameters].sort((a, b) => a.validFrom.localeCompare(b.validFrom));

        for (const entry of entries) {
            this.parameterContract.validate(entry.values);
            if (entry.validTo !== null && entry.validTo < entry.validFrom) {
                throw new Error(
                    `Risk Indicator ${this.key.id}: parameter entry validTo (${entry.validTo}) is earlier than validFrom (${entry.validFrom})`,
                );
            }
        }

        for (let i = 0; i < entries.length - 1; i++) {
            const current = entries[i];
            const next = entries[i + 1];
            if (current.validTo === null) {
                throw new Error(
                    `Risk Indicator ${this.key.id}: parameter entry starting ${current.validFrom} is open-ended but is followed by another entry starting ${next.validFrom}`,
                );
            }
            if (current.validTo !== next.validFrom) {
                throw new Error(
                    `Risk Indicator ${this.key.id}: parameter entries have a gap or overlap between ${current.validTo} and ${next.validFrom}`,
                );
            }
        }
    }
}
