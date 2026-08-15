import {
    subjectFactsContract,
    type ParameterEntry,
    type RiskObservationV1,
    type SubjectFacts,
    type Decision,
} from "./contracts.ts";
import type { EvaluationContext } from "./evaluationContext.ts";
import { RiskIndicator, type RiskIndicatorDefinition } from "./riskIndicator.ts";
import type { RiskDataSource } from "./riskDataSource.ts";
import { loadPackagedSql } from "./sqlLoader.ts";

// The common shape: collect.sql returns one fact row per subject; decide()
// is a pure function that turns one fact row into a Decision. This class
// binds $1/$2, resolves the parameter entry, and assembles the observation
// row around decide()'s result. See
// docs/indicators-story/risk-service-architecture.md §4.4.

export type SubjectFactsIndicatorDefinition<F extends SubjectFacts, P> = RiskIndicatorDefinition<P> &
    Readonly<{
        // Path to the collection statement, relative to the definition file,
        // e.g. './collect.sql'.
        sqlFile: string;
        // decide: called from observe() (below) only when parameterEntryFor
        // found a covering entry; NOT_APPLICABLE is returned otherwise.
        decide: (facts: F, parameters: P) => Decision;
    }>;

const NOT_APPLICABLE: Decision = { state: "not_applicable" };

export class SubjectFactsIndicator<F extends SubjectFacts, P = unknown> extends RiskIndicator<P> {
    readonly sqlFile: string;
    private readonly definitionUrl: string;
    private readonly decide: (facts: F, parameters: P) => Decision;

    /**
     * `definitionUrl` resolves `sqlFile` against the indicator's own
     * directory — pass `import.meta.url` from `definition.ts`.
     */
    constructor(definition: SubjectFactsIndicatorDefinition<F, P>, definitionUrl: string) {
        super(definition);
        this.sqlFile = definition.sqlFile;
        this.definitionUrl = definitionUrl;
        this.decide = definition.decide;
    }

    protected async calculate(context: EvaluationContext, data: RiskDataSource): Promise<readonly RiskObservationV1[]> {
        const facts = await data.query<F>(this.loadSql(), this.bindParameters(context));
        return facts.map((row) => this.observe(row, context.dataAsOf));
    }

    private loadSql(): string {
        return loadPackagedSql(this.definitionUrl, this.sqlFile);
    }

    // $1 = context.dataAsOf, $2 = context.subjects.
    private bindParameters(context: EvaluationContext): readonly unknown[] {
        return [context.dataAsOf, context.subjects];
    }

    /** One fact row becomes one observation: decide, then fill in the rest. */
    private observe(row: F, dataAsOf: string): RiskObservationV1 {
        const facts = this.assertSubjectFacts(row);
        const entry = this.parameterEntryFor(dataAsOf, facts);
        const decision = entry === null ? NOT_APPLICABLE : this.decide(row, entry.values);

        return {
            indicatorId: this.key.id,
            indicatorVersion: this.key.version,
            subjectType: this.subjectType,
            subjectKey: facts.subjectKey,
            procurementSource: facts.procurementSource,
            procurementId: facts.procurementId,
            state: decision.state,
            rawValue: decision.rawValue ?? null,
            threshold: decision.threshold ?? null,
            appliedParameters: applied(entry),
            evidence: decision.evidence ?? {},
            missingData: [...(decision.missingData ?? [])],
            dataAsOf,
        };
    }

    // A missing SubjectFacts column means collect.sql is wrong; the thrown
    // error names this.sqlFile.
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
