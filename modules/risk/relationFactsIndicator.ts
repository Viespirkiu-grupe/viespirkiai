import type { Decision, EligibilityOutcome, RiskObservationV1, Subject, SubjectFacts } from "./contracts.ts";
import type { EvaluationContext } from "./evaluationContext.ts";
import { lotEligibility, procurementEligibility, type EligibilityGate } from "./procurementEligibility.ts";
import { RiskIndicator, type RiskIndicatorDefinition } from "./riskIndicator.ts";
import type { RiskDataSource } from "./riskDataSource.ts";
import { loadPackagedSql } from "./sqlLoader.ts";

// The shared shape for an indicator that (a) starts from the Procurement/Lot
// Eligibility Decision and (b) needs one supplemental bulk fact per subject
// beyond what the Procurement/Lot object already carries — exactly what
// LT-COM-01/02/03 need (a distinct-supplier count from public.v_dalyviai).
// Replaces subjectFactsIndicator.ts's "collect.sql + decide()" shape: the
// bulk query now runs once per run via prepare() (see riskIndicator.ts),
// not once per indicator.evaluate() call reading every subject's own row.

export type RelationFactsIndicatorDefinition<F, P> = RiskIndicatorDefinition<P> &
    Readonly<{
        // Path to the bulk facts query, relative to the definition file,
        // e.g. './collect.sql'. Bound $1=dataAsOf, $2=subjects — same
        // convention as today's collect.sql.
        sqlFile: string;
        // Groups a bulk-query row under the key subjectKey() below also
        // produces, so assessRisk can look a subject's facts up in O(1).
        factKey: (row: F) => string;
        subjectKey: (subject: Subject) => string;
        // Feeds both the decision's evidence and parameterEntryFor's scope
        // resolution (SubjectFacts.method).
        methodOf: (row: F) => string | null;
        // isEligible's insufficient_data reason when no bulk-query row
        // exists for a subject that passed the eligibility gate.
        missingDataWhenAbsent: readonly string[];
        decide: (subject: Subject, facts: F, parameters: P) => Decision;
    }>;

export class RelationFactsIndicator<F, P = unknown> extends RiskIndicator<P> {
    private readonly def: RelationFactsIndicatorDefinition<F, P>;
    private readonly definitionUrl: string;
    private factsByKey = new Map<string, F>();

    /**
     * `definitionUrl` resolves `sqlFile` against the indicator's own
     * directory — pass `import.meta.url` from `definition.ts`.
     */
    constructor(definition: RelationFactsIndicatorDefinition<F, P>, definitionUrl: string) {
        super(definition);
        this.def = definition;
        this.definitionUrl = definitionUrl;
    }

    protected async prepare(context: EvaluationContext, data: RiskDataSource): Promise<void> {
        const sql = loadPackagedSql(this.definitionUrl, this.def.sqlFile);
        const rows = await data.query<F>(sql, [context.dataAsOf, context.subjects]);
        this.factsByKey = new Map(rows.map((row) => [this.def.factKey(row), row]));
    }

    protected isEligible(subject: Subject, context: EvaluationContext): EligibilityOutcome {
        const gate: EligibilityGate =
            subject.subjectType === "lot"
                ? lotEligibility(subject.lot, subject.procurement)
                : procurementEligibility(subject.procurement);

        if (!gate.eligible) {
            return { eligible: false, signal: this.signalFor(subject, context, gate.decision, null) };
        }

        const facts = this.factsByKey.get(this.def.subjectKey(subject));
        if (facts === undefined) {
            const decision: Decision = {
                state: "insufficient_data",
                missingData: [...this.def.missingDataWhenAbsent],
            };
            return { eligible: false, signal: this.signalFor(subject, context, decision, null) };
        }

        return { eligible: true };
    }

    protected assessRisk(subject: Subject, context: EvaluationContext): RiskObservationV1 {
        // isEligible already proved this key is present.
        const facts = this.factsByKey.get(this.def.subjectKey(subject))!;
        const scopeFacts: SubjectFacts = {
            subjectKey: subject.subjectKey,
            procurementSource: subject.procurementSource,
            procurementId: subject.procurementId,
            method: this.def.methodOf(facts),
        };
        const entry = this.parameterEntryFor(context.dataAsOf, scopeFacts);
        const decision: Decision =
            entry === null ? { state: "not_applicable" } : this.def.decide(subject, facts, entry.values);
        const appliedParameters = entry === null ? null : (entry.values as Readonly<Record<string, unknown>>);

        return this.signalFor(subject, context, decision, appliedParameters);
    }
}
