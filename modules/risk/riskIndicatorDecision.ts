import { riskSignalContract } from "./contracts.ts";
import type { EvaluationContext } from "./evaluationContext.ts";
import type {
    EligibilityOutcome,
    PartialRiskSignal,
    ParameterEntry,
    ParametersOf,
    RiskIndicatorDefinition,
    RiskSignal,
    RuntimeContract,
    Subject,
} from "./types.ts";

// The behaviour half of a Risk Indicator version — the counterpart to the
// pure-data RiskIndicatorDefinition (types.ts). See
// docs/indicators-story/risk-service-architecture-v2.md §3.4.

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
 * A Risk Indicator decides exactly one subject at a time — batching over the
 * whole subject universe belongs to RiskDecisionEngine
 * (riskDecisionEngine.ts), not here. See
 * docs/indicators-story/risk-service-architecture-v2.md §3.4.
 */
export abstract class ARiskIndicatorDecision<D extends RiskIndicatorDefinition = RiskIndicatorDefinition>
    implements RiskIndicatorDecision
{
    readonly definition: D;
    readonly outputContract: RuntimeContract<RiskSignal>;

    /**
     * Throws on an id outside the catalogue namespace, missing public
     * wording, or a gapped/overlapping parameter timeline. See
     * docs/indicators-story/risk-service-architecture-v2.md §3.4.
     */
    protected constructor(definition: D) {
        this.definition = definition;
        this.outputContract = definition.outputContract ?? riskSignalContract;

        // @Todo: eliminate - this assert is not needed
        this.assertIdentity();

        // @Todo: eliminate - this assert is not needed
        this.assertPublicWording();

        // @Todo: no assert is needed, simply have isActive() method that is checked before calling indicator
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

    /** Catalogue identity as one string, e.g. `LT-COM-01/1`. */
    toString(): string {
        return `${this.id}/${this.version}`;
    }

    /** The parameter entries in force at a cutoff. */
    parametersAsOf(dataAsOf: string): readonly ParameterEntry<ParametersOf<D>>[] {
        return this.parameters.filter(
            (entry) => entry.validFrom <= dataAsOf && (entry.validTo === null || entry.validTo > dataAsOf),
        );
    }

    /**
     * The one entry that decides a subject at a cutoff: in force by date.
     * `null` means no parameter entry covers this subject. See
     * docs/indicators-story/risk-service-architecture-v2.md §3.4.
     *
     * assertParameterTimeline (below) rejects gapped/overlapping entries, so
     * at most one entry can be in force at any cutoff.
     */
    parameterEntryFor(dataAsOf: string): ParameterEntry<ParametersOf<D>> | null {
        return this.parametersAsOf(dataAsOf)[0] ?? null;
    }

    // Whether this subject carries the data this indicator needs to judge
    // (e.g. Subject.lot.participation !== null) — the replacement for the
    // old "did the bulk query return a row for this subject?" check, now
    // that there's no bulk query.
    protected abstract hasRequiredData(subject: Subject): boolean;
    // isEligible's insufficient_data reason when hasRequiredData is false.
    protected abstract readonly missingDataWhenAbsent: readonly string[];

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
     * Never called otherwise (RiskDecisionEngine only calls this after a
     * successful isEligible()). Abstract: judging a subject — what it means,
     * which parameter entry applies, what counts as triggered — is each
     * indicator's own job. A concrete indicator's assessRisk() typically
     * calls parameterEntryFor() then signalFor() (both below) rather than
     * assembling a RiskSignal by hand.
     */
    abstract assessRisk(subject: Subject, context: EvaluationContext): RiskSignal;

    /**
     * Assembles a full RiskSignal around a PartialRiskSignal — the fields an
     * indicator's assessRisk() (or isEligible()'s ineligible branch) does
     * not need to repeat every time. If an indicator cannot construct every
     * field itself (no applicable parameter entry, missing data), it returns
     * only what it knows (typically just `state`, plus `evidence`/
     * `missingData`) and this fills in the rest.
     */
    protected signalFor(subject: Subject, context: EvaluationContext, partial: PartialRiskSignal): RiskSignal {
        return {
            indicatorId: this.id,
            indicatorVersion: this.version,
            subjectType: subject.subjectType,
            subjectKey: subject.subjectKey,
            procurementSource: subject.procurementSource,
            procurementId: subject.procurementId,
            state: partial.state,
            rawValue: partial.rawValue ?? null,
            threshold: partial.threshold ?? null,
            appliedParameters: partial.appliedParameters ?? null,
            evidence: partial.evidence ?? {},
            missingData: [...(partial.missingData ?? [])],
            dataAsOf: context.dataAsOf,
        };
    }

    /**
     * Validates rows against the output contract, then checks that each
     * row's indicatorId/indicatorVersion match this indicator's key and that
     * no (subjectType, subjectKey) pair repeats within the batch. Called by
     * RiskDecisionEngine once per indicator, over everything that indicator
     * produced across a whole evaluateAll() run — not by this class itself,
     * which only ever decides one subject at a time. See
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

    // See docs/indicators-story/risk-service-architecture-v2.md §3.4.
    private assertParameterTimeline(): void {
        const entries = [...this.parameters].sort((a, b) => a.validFrom.localeCompare(b.validFrom));

        for (const entry of entries) {
            if (entry.validTo !== null && entry.validTo < entry.validFrom) {
                throw new Error(
                    `Risk Indicator ${this.id}: parameter entry validTo (${entry.validTo}) is earlier than validFrom (${entry.validFrom})`,
                );
            }
        }

        this.assertContiguous(entries);
    }

    // One global timeline, since a parameter entry no longer carries a scope
    // to narrow which subjects it applies to.
    private assertContiguous(sortedEntries: readonly ParameterEntry<ParametersOf<D>>[]): void {
        for (let i = 0; i < sortedEntries.length - 1; i++) {
            const current = sortedEntries[i];
            const next = sortedEntries[i + 1];

            if (current.validTo === null) {
                throw new Error(
                    `Risk Indicator ${this.id}: parameter entry starting ${current.validFrom} is open-ended but is followed by another entry starting ${next.validFrom}`,
                );
            }
            if (current.validTo !== next.validFrom) {
                throw new Error(
                    `Risk Indicator ${this.id}: parameter entries have a gap or overlap between ${current.validTo} and ${next.validFrom}`,
                );
            }
        }
    }
}
