import type { EvaluationContext, ParameterEntry } from "./contracts.ts";

export type QueryExecutor = <T>(sqlText: string, params?: readonly unknown[]) => Promise<readonly T[]>;

/**
 * Builds the EvaluationContext a Risk Indicator calculation runs against.
 * `query` executes on whatever connection the caller supplies — the run job
 * uses the read-only pool against the real database (§1.2's `risk_calc`
 * stand-in, see postgres/riskDb.js); tests use the same shape against the
 * local Docker Postgres's test schema (§11: "tests exercise the calculation
 * through the same evaluation context the run job supplies").
 */
export function createEvaluationContext(
    query: QueryExecutor,
    opts: {
        runId: number;
        dataAsOf: string;
        parameters: readonly ParameterEntry<unknown>[];
        subjects: readonly string[] | null;
    },
): EvaluationContext {
    return Object.freeze({
        runId: opts.runId,
        dataAsOf: opts.dataAsOf,
        parameters: opts.parameters,
        subjects: opts.subjects,

        // @Todo: the method should be named either executeSql or query (not just sql).
        // @Todo: this method is not context responsibility, find another way. Use best OOP practices and separation of concerns.
        sql<T>(sqlText: string, params?: readonly unknown[]): Promise<readonly T[]> {
            return query<T>(sqlText, params);
        },
    });
}
