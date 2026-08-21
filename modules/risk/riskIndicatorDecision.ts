import { riskSignalContract, zodContract } from "./contracts.ts";
import { EvaluationContext, type EvaluationRun } from "./evaluationContext.ts";
import { describeScope, scopeAdmits, scopeKey, scopesAreDisjoint } from "./parameterScope.ts";
import type {
    Decision,
    EligibilityOutcome,
    ParameterEntry,
    ParametersOf,
    RiskIndicatorDefinition,
    RiskSignal,
    RuntimeContract,
    Subject,
    SubjectFacts,
} from "./types.ts";

// The behaviour half of a Risk Indicator version — the counterpart to the
// pure-data RiskIndicatorDefinition (types.ts). See
// docs/indicators-story/risk-service-architecture-v2.md §3.4.

// Half-open validity ranges [validFrom, validTo), where a null validTo is
// "still in force".
function overlapInTime(a: ParameterEntry<unknown>, b: ParameterEntry<unknown>): boolean {
    const aEndsAfterBStarts = a.validTo === null || a.validTo > b.validFrom;
    const bEndsAfterAStarts = b.validTo === null || b.validTo > a.validFrom;
    return aEndsAfterBStarts && bEndsAfterAStarts;
}

// The minimal contract every Risk Indicator decision must satisfy: given a
// subject, is it eligible, and if so, what does it decide? A public
// interface — implemented by ARiskIndicatorDecision below, but not part of
// it — so isEligible/assessRisk are public methods, not protected.
export interface RiskIndicatorDecision {
    isEligible(subject: Subject, context: EvaluationContext): EligibilityOutcome;
    assessRisk(subject: Subject, context: EvaluationContext): RiskSignal;
}

/**
 * The template abstract class every concrete indicator's decision.ts
 * extends (directly, or via a subject-type specialization such as
 * AProcurementIndicatorDecision/ALotIndicatorDecision in
 * procurementLotDecision.ts): `class LtCom01Decision extends
 * ALotIndicatorDecision<typeof ltCom01Definition>`.
 *
 * `D` is the indicator's own RiskIndicatorDefinition shape, so
 * `this.definition` and the parameter-timeline helpers below are typed to
 * that indicator's own parameter type, not `unknown`.
 *
 * Validates the definition it's constructed with, resolves its own effective
 * parameters, and decides every subject of its own subjectType. No bulk
 * per-indicator SQL prefetch: the Procurement Reader (procurementReader.ts)
 * already loaded everything an indicator needs onto Subject.procurement/
 * Subject.lot, so evaluate() is synchronous.
 * `isEligible`/`assessRisk` are abstract on purpose: the eligibility gate
 * differs by subject type (procurement vs lot), so it belongs to a
 * subject-type-specific subclass, not this generic one — see
 * procurementLotDecision.ts. See
 * docs/indicators-story/risk-service-architecture-v2.md §3.4.
 */
export abstract class ARiskIndicatorDecision<D extends RiskIndicatorDefinition = RiskIndicatorDefinition>
    implements RiskIndicatorDecision
{
    readonly definition: D;
    private readonly parameterContract: RuntimeContract<ParametersOf<D>>;
    readonly outputContract: RuntimeContract<RiskSignal>;

    /**
     * Throws on an id outside the catalogue namespace, missing public
     * wording, parameter values that violate the indicator's own contract,
     * or a gapped/overlapping parameter timeline. See
     * docs/indicators-story/risk-service-architecture.md §4.3.
     */
    protected constructor(definition: D) {
        this.definition = definition;
        this.parameterContract = zodContract(definition.parameterSchema as never) as RuntimeContract<ParametersOf<D>>;
        this.outputContract = definition.outputContract ?? riskSignalContract;

        this.assertIdentity();
        this.assertPublicWording();
        this.assertParameterTimeline();
    }

    get key() {
        return this.definition.key;
    }

    get id(): string {
        return this.definition.key.id;
    }

    get version(): number {
        return this.definition.key.version;
    }

    get lifecycle() {
        return this.definition.lifecycle;
    }

    get subjectType() {
        return this.definition.subjectType;
    }

    get stage() {
        return this.definition.stage;
    }

    get references() {
        return this.definition.references;
    }

    get sourceRelations() {
        return this.definition.sourceRelations;
    }

    get requiredInputs() {
        return this.definition.requiredInputs;
    }

    get parameters(): readonly ParameterEntry<ParametersOf<D>>[] {
        return this.definition.parameters as readonly ParameterEntry<ParametersOf<D>>[];
    }

    get standard() {
        return this.definition.standard;
    }

    get public() {
        return this.definition.public;
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
        return `${this.id}/${this.version}`;
    }

    /** The parameter entries in force at a cutoff, across all scopes. */
    parametersAsOf(dataAsOf: string): readonly ParameterEntry<ParametersOf<D>>[] {
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
    parameterEntryFor(dataAsOf: string, facts: SubjectFacts): ParameterEntry<ParametersOf<D>> | null {
        return this.parametersAsOf(dataAsOf).find((entry) => scopeAdmits(entry.scope, facts)) ?? null;
    }

    /**
     * The pirkimoBudas that scopes a subject: a lot deliberately carries no
     * pirkimoBudas of its own (types.ts's Lot comment) — its method is
     * always its parent procurement's. Concrete because it needs no
     * per-indicator override now that Subject.procurement is always
     * populated by the time this runs.
     */
    protected methodOf(subject: Subject): string | null {
        return subject.procurement.pirkimoBudas;
    }

    /** The objectType that scopes a subject — same derivation as methodOf. */
    protected objectTypeOf(subject: Subject): string | null {
        return subject.procurement.pirkimoObjektoTipas;
    }

    // Whether this subject carries the data this indicator needs to judge
    // (e.g. Subject.lot.participation !== null) — the replacement for the
    // old "did the bulk query return a row for this subject?" check, now
    // that there's no bulk query.
    protected abstract hasRequiredData(subject: Subject): boolean;
    // isEligible's insufficient_data reason when hasRequiredData is false.
    protected abstract readonly missingDataWhenAbsent: readonly string[];
    protected abstract decide(subject: Subject, parameters: ParametersOf<D>): Decision;

    /**
     * Business + data eligibility gate for one subject (architecture-v2.md
     * §3.3/§3.4). Abstract here: the gate differs by subject type
     * (procurement vs lot), so a subject-type-specific subclass —
     * AProcurementIndicatorDecision or ALotIndicatorDecision
     * (procurementLotDecision.ts) — implements it, typically by calling the
     * shared Procurement/Lot Eligibility Decision, then hasRequiredData().
     * Synchronous: reads only Subject.procurement/Subject.lot, which the
     * Procurement Reader already populated. Public because
     * RiskIndicatorDecision declares it.
     */
    abstract isEligible(subject: Subject, context: EvaluationContext): EligibilityOutcome;

    /**
     * Risk assessment for one subject isEligible() already found eligible.
     * Never called otherwise. Subject-type-agnostic — it only needs
     * hasRequiredData() to already hold — so it's concrete here rather than
     * duplicated per subject type.
     */
    assessRisk(subject: Subject, context: EvaluationContext): RiskSignal {
        const scopeFacts: SubjectFacts = {
            subjectKey: subject.subjectKey,
            procurementSource: subject.procurementSource,
            procurementId: subject.procurementId,
            method: this.methodOf(subject),
            objectType: this.objectTypeOf(subject),
        };
        const entry = this.parameterEntryFor(context.dataAsOf, scopeFacts);
        const decision: Decision = entry === null ? { state: "not_applicable" } : this.decide(subject, entry.values);
        const appliedParameters = entry === null ? null : (entry.values as Readonly<Record<string, unknown>>);

        return this.signalFor(subject, context, decision, appliedParameters);
    }

    /**
     * Assembles a full observation around a partial Decision — the fields
     * neither isEligible's ineligible branch nor assessRisk's decide() step
     * needs to repeat every time.
     */
    protected signalFor(
        subject: Subject,
        context: EvaluationContext,
        decision: Decision,
        appliedParameters: Readonly<Record<string, unknown>> | null,
    ): RiskSignal {
        return {
            indicatorId: this.id,
            indicatorVersion: this.version,
            subjectType: subject.subjectType,
            subjectKey: subject.subjectKey,
            procurementSource: subject.procurementSource,
            procurementId: subject.procurementId,
            state: decision.state,
            rawValue: decision.rawValue ?? null,
            threshold: decision.threshold ?? null,
            appliedParameters,
            evidence: decision.evidence ?? {},
            missingData: [...(decision.missingData ?? [])],
            dataAsOf: context.dataAsOf,
        };
    }

    /**
     * Resolves this indicator's effective parameters for the run's cutoff,
     * decides every subject of this indicator's own subjectType (isEligible,
     * then assessRisk when eligible), and validates the batch via
     * validateObservations().
     */
    evaluate(run: EvaluationRun, subjects: readonly Subject[]): readonly RiskSignal[] {
        const context = new EvaluationContext(run, this.parametersAsOf(run.dataAsOf) as readonly ParameterEntry<unknown>[]);

        const mine = subjects.filter((subject) => subject.subjectType === this.subjectType);
        const signals = mine.map((subject) => {
            const outcome = this.isEligible(subject, context);
            return outcome.eligible ? this.assessRisk(subject, context) : outcome.signal;
        });

        return this.validateObservations(signals);
    }

    /**
     * Validates rows against the output contract, then checks that each
     * row's indicatorId/indicatorVersion match this indicator's key and that
     * no (subjectType, subjectKey) pair repeats within the batch. See
     * docs/indicators-story/risk-schema.md §2.
     */
    validateObservations(observations: readonly unknown[]): readonly RiskSignal[] {
        const seen = new Set<string>();
        const validated: RiskSignal[] = [];

        for (const raw of observations) {
            const observation = this.outputContract.validate(raw);

            if (observation.indicatorId !== this.id || observation.indicatorVersion !== this.version) {
                throw new Error(
                    `${this.id}: observation carries indicator identity ${observation.indicatorId}/${observation.indicatorVersion}, expected ${this}`,
                );
            }
            if (observation.subjectType !== this.subjectType) {
                throw new Error(
                    `${this.id}: observation subjectType ${observation.subjectType} does not match the indicator's declared subjectType ${this.subjectType}`,
                );
            }

            const dedupeKey = `${observation.subjectType}:${observation.subjectKey}`;
            if (seen.has(dedupeKey)) {
                throw new Error(`${this.id}: duplicate observation for subject ${dedupeKey}`);
            }
            seen.add(dedupeKey);

            validated.push(observation);
        }

        return validated;
    }

    private assertIdentity(): void {
        if (!this.id.startsWith("LT-")) {
            throw new Error(`Risk Indicator id must start with 'LT-': ${this.id}`);
        }
    }

    private assertPublicWording(): void {
        if (!this.public.titleLt || !this.public.limitationLt) {
            throw new Error(`Risk Indicator ${this.id}: public.titleLt and public.limitationLt must be non-empty`);
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
                    `Risk Indicator ${this.id}: parameter entry validTo (${entry.validTo}) is earlier than validFrom (${entry.validFrom})`,
                );
            }
        }

        this.assertContiguousWithinScope(entries);
        this.assertDisjointWhereConcurrent(entries);
    }

    private assertContiguousWithinScope(sortedEntries: readonly ParameterEntry<ParametersOf<D>>[]): void {
        const byScope = new Map<string, ParameterEntry<ParametersOf<D>>[]>();
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
                        `Risk Indicator ${this.id}: parameter entry starting ${current.validFrom} (${scope}) is open-ended but is followed by another entry starting ${next.validFrom}`,
                    );
                }
                if (current.validTo !== next.validFrom) {
                    throw new Error(
                        `Risk Indicator ${this.id}: parameter entries for ${scope} have a gap or overlap between ${current.validTo} and ${next.validFrom}`,
                    );
                }
            }
        }
    }

    private assertDisjointWhereConcurrent(sortedEntries: readonly ParameterEntry<ParametersOf<D>>[]): void {
        for (let i = 0; i < sortedEntries.length; i++) {
            for (let j = i + 1; j < sortedEntries.length; j++) {
                const a = sortedEntries[i];
                const b = sortedEntries[j];
                if (scopeKey(a.scope) === scopeKey(b.scope)) continue; // handled as one timeline
                if (!overlapInTime(a, b)) continue;
                if (scopesAreDisjoint(a.scope, b.scope)) continue;

                throw new Error(
                    `Risk Indicator ${this.id}: parameter entries starting ${a.validFrom} (${describeScope(a.scope)}) and ${b.validFrom} (${describeScope(b.scope)}) are valid at the same time with overlapping scopes, so a subject could match both`,
                );
            }
        }
    }
}
