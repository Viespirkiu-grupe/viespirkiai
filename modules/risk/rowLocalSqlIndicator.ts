import {
    subjectFactsContract,
    type ParameterEntry,
    type RiskObservationV1,
    type SubjectFacts,
    type Verdict,
} from "./contracts.ts";
import type { EvaluationContext } from "./evaluationContext.ts";
import { RiskIndicator, type RiskIndicatorDefinition } from "./riskIndicator.ts";
import type { RiskDataSource } from "./riskDataSource.ts";
import { loadPackagedSql } from "./sqlLoader.ts";

// The common shape (risk-service-architecture.md §5.3.1): collect one fact row
// per subject with a packaged SELECT, judge each row with a pure function, and
// assemble the observations. Roughly 78 of the 106 catalogue indicators fit it.
//
// The division of labour is the point. `collect.sql` states what is true and
// decides nothing — no indicator identity, no state, no threshold. `verdict`
// decides what that means and knows nothing about persistence, identity or the
// parameter timeline. Everything in between — binding $1/$2, choosing the
// parameter entry, `not_applicable` when none applies, stamping identity and
// the cutoff onto the row — is here, written once, and therefore cannot be got
// wrong in an indicator's own directory.

export type RowLocalSqlIndicatorDefinition<F extends SubjectFacts, P> = RiskIndicatorDefinition<P> &
    Readonly<{
        // Path to the collection statement, relative to the definition file,
        // e.g. './collect.sql'.
        sqlFile: string;
        // HOW IT JUDGES. Pure: no database, no clock, no identity fields. It
        // is called only for a subject a reviewed parameter entry covers, so
        // it never has to handle missing parameters.
        verdict: (facts: F, parameters: P) => Verdict;
    }>;

const NOT_APPLICABLE: Verdict = { state: "not_applicable" };

export class RowLocalSqlIndicator<F extends SubjectFacts, P = unknown> extends RiskIndicator<P> {
    readonly sqlFile: string;
    private readonly definitionUrl: string;
    private readonly verdict: (facts: F, parameters: P) => Verdict;

    /**
     * `definitionUrl` resolves `sqlFile` against the indicator's own
     * directory — pass `import.meta.url` from `definition.ts`.
     */
    constructor(definition: RowLocalSqlIndicatorDefinition<F, P>, definitionUrl: string) {
        super(definition);
        this.sqlFile = definition.sqlFile;
        this.definitionUrl = definitionUrl;
        this.verdict = definition.verdict;
    }

    protected async calculate(context: EvaluationContext, data: RiskDataSource): Promise<readonly RiskObservationV1[]> {
        const facts = await data.query<F>(this.loadSql(), this.bindParameters(context));
        return facts.map((row) => this.observe(row, context.dataAsOf));
    }

    private loadSql(): string {
        return loadPackagedSql(this.definitionUrl, this.sqlFile);
    }

    // $1 the data_as_of cutoff, $2 an optional subject filter (NULL for a full
    // run). Thresholds are deliberately absent: policy is resolved here and
    // applied by `verdict`, so the collection statement carries none.
    private bindParameters(context: EvaluationContext): readonly unknown[] {
        return [context.dataAsOf, context.subjects];
    }

    /** One fact row becomes one observation: judge, then fill in the rest. */
    private observe(row: F, dataAsOf: string): RiskObservationV1 {
        const facts = this.assertSubjectFacts(row);
        const entry = this.parameterEntryFor(dataAsOf, facts);
        const verdict = entry === null ? NOT_APPLICABLE : this.verdict(row, entry.values);

        return {
            indicatorId: this.key.id,
            indicatorVersion: this.key.version,
            subjectType: this.subjectType,
            subjectKey: facts.subjectKey,
            procurementSource: facts.procurementSource,
            procurementId: facts.procurementId,
            state: verdict.state,
            rawValue: verdict.rawValue ?? null,
            threshold: verdict.threshold ?? null,
            appliedParameters: applied(entry),
            evidence: verdict.evidence ?? {},
            missingData: [...(verdict.missingData ?? [])],
            dataAsOf,
        };
    }

    // The SubjectFacts columns cross a trust boundary — they come back from
    // PostgreSQL — and a missing one is a mistake in collect.sql. Checking it
    // here names the file at fault; leaving it to the output contract would
    // report a malformed observation instead.
    private assertSubjectFacts(row: F): SubjectFacts {
        try {
            return subjectFactsContract.validate(row);
        } catch (cause) {
            throw new Error(
                `${this.key.id}: ${this.sqlFile} returned a row that is not a valid SubjectFacts (needs subjectKey, procurementSource, procurementId)`,
                { cause },
            );
        }
    }
}

function applied<P>(entry: ParameterEntry<P> | null): Readonly<Record<string, unknown>> | null {
    return entry === null ? null : (entry.values as Readonly<Record<string, unknown>>);
}
