import { riskSignalContract } from "./contracts.ts";
import type { EvaluationContext } from "./evaluationContext.ts";
import type {
    EligibilityOutcome,
    PartialRiskSignal,
    ParametersOf,
    RiskIndicatorDefinition,
    RiskSignal,
    Subject,
} from "./types.ts";

// The behaviour half of a Risk Indicator version — the counterpart to the
// pure-data RiskIndicatorDefinition (types.ts). See
// docs/indicators-story/risk-service-architecture-v2.md §3.4.

// The minimal contract every Risk Indicator decision must satisfy: given a
// subject, is it eligible, and if so, what does it decide? A public
// interface — implemented by ARiskIndicatorDecision below, but not part of
// it — so isEligible/assessRisk are public methods, not protected.
export interface RiskIndicatorDecision<S extends Subject = Subject> {
    isEligible(subject: S): EligibilityOutcome;
    assessRisk(subject: S): RiskSignal;
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
 * `S` is the indicator's own Subject variant (ProcurementSubject/LotSubject)
 * — fixed by the subject-type specialization it extends
 * (AProcurementIndicatorDecision/ALotIndicatorDecision in
 * procurementLotDecision.ts) — so isEligible/assessRisk/hasRequiredData are
 * typed to that indicator's own subject shape, never `Subject` needing a
 * cast.
 *
 * A Risk Indicator decides exactly one subject at a time — batching over the
 * whole subject universe belongs to RiskDecisionEngine
 * (riskDecisionEngine.ts), not here. See
 * docs/indicators-story/risk-service-architecture-v2.md §3.4.
 */
export abstract class ARiskIndicatorDecision<
    D extends RiskIndicatorDefinition = RiskIndicatorDefinition,
    S extends Subject = Subject,
> implements RiskIndicatorDecision<S>
{
    readonly definition: D;
    readonly context: EvaluationContext;

    protected constructor(definition: D, context: EvaluationContext) {
        this.definition = definition;
        this.context = context;
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

    get parameters(): ParametersOf<D> {
        return this.definition.parameters as ParametersOf<D>;
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

    /**
     * The definition's parameters, if they are in force at a cutoff — `null`
     * if `dataAsOf` falls outside [validFrom, validTo). See
     * docs/indicators-story/risk-service-architecture-v2.md §3.4.
     */
    parameterEntryFor(dataAsOf: string): ParametersOf<D> | null {
        const parameters = this.parameters;
        return parameters.validFrom <= dataAsOf && (parameters.validTo === null || parameters.validTo > dataAsOf)
            ? parameters
            : null;
    }

    // Whether this subject carries the data this indicator needs to judge
    // (e.g. Subject.lot.participation !== null) — the replacement for the
    // old "did the bulk query return a row for this subject?" check, now
    // that there's no bulk query.
    protected abstract hasRequiredData(subject: S): boolean;
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
    abstract isEligible(subject: S): EligibilityOutcome;

    /**
     * Risk assessment for one subject isEligible() already found eligible.
     * Never called otherwise (RiskDecisionEngine only calls this after a
     * successful isEligible()). Abstract: judging a subject — what it means,
     * which parameter entry applies, what counts as triggered — is each
     * indicator's own job. A concrete indicator's assessRisk() typically
     * calls parameterEntryFor() then signalFor() (both below) rather than
     * assembling a RiskSignal by hand.
     */
    abstract assessRisk(subject: S): RiskSignal;

    /**
     * Assembles a full RiskSignal around a PartialRiskSignal — the fields an
     * indicator's assessRisk() (or isEligible()'s ineligible branch) does
     * not need to repeat every time. If an indicator cannot construct every
     * field itself (no applicable parameter entry, missing data), it returns
     * only what it knows (typically just `state`, plus `missingData`) and
     * this fills in the rest. Every RiskSignal in the
     * system is built here, so this is also where the output contract runs
     * (schema validation of what assessRisk()/isEligible() produced) — the
     * result is frozen, since it's about to be handed to the Engine and,
     * from there, straight to the Signal Writer.
     */
    protected signalFor(subject: S, partial: PartialRiskSignal): RiskSignal {
        const signal = riskSignalContract.validate({
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
            missingData: [...(partial.missingData ?? [])],
            dataAsOf: this.context.dataAsOf,
        });
        return Object.freeze(signal);
    }
}
