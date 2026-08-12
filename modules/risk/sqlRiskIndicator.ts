import type { RiskObservationV1 } from "./contracts.ts";
import type { EvaluationContext } from "./evaluationContext.ts";
import { RiskIndicator, type RiskIndicatorDefinition } from "./riskIndicator.ts";
import type { RiskDataSource } from "./riskDataSource.ts";
import { loadPackagedSql } from "./sqlLoader.ts";

// The common case (§5.3.1): the whole calculation is one pure, parameterised
// SELECT packaged next to the definition. The class owns the calling
// convention of that statement — the four positional parameters every
// calculate.sql declares — so the convention lives where the SQL lives
// instead of leaking into shared machinery.

export type SqlRiskIndicatorDefinition<P> = RiskIndicatorDefinition<P> &
    Readonly<{
        // Path to the packaged statement, relative to the definition file,
        // e.g. './calculate.sql'.
        sqlFile: string;
    }>;

export class SqlRiskIndicator<P = unknown> extends RiskIndicator<P> {
    readonly sqlFile: string;
    private readonly definitionUrl: string;

    /**
     * `definitionUrl` resolves `sqlFile` against the indicator's own
     * directory — pass `import.meta.url` from `definition.ts`.
     */
    constructor(definition: SqlRiskIndicatorDefinition<P>, definitionUrl: string) {
        super(definition);
        this.sqlFile = definition.sqlFile;
        this.definitionUrl = definitionUrl;
    }

    protected calculate(context: EvaluationContext, data: RiskDataSource): Promise<readonly RiskObservationV1[]> {
        return data.query<RiskObservationV1>(this.loadSql(), this.bindParameters(context));
    }

    private loadSql(): string {
        return loadPackagedSql(this.definitionUrl, this.sqlFile);
    }

    // $1 run id, $2 data_as_of cutoff, $3 effective parameter entries as a
    // jsonb array, $4 optional subject filter (NULL for a full run).
    private bindParameters(context: EvaluationContext): readonly unknown[] {
        return [context.runId, context.dataAsOf, JSON.stringify(context.parameters), context.subjects];
    }
}
