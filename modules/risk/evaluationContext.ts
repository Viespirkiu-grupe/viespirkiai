import type { ParameterEntry } from "./contracts.ts";

// One run's inputs, as a value object. A run has exactly two of its own
// (risk-service-architecture.md §5.2.2) — the `data_as_of` cutoff and the
// subject set — plus the identity of the run row and the parameter entries
// the indicator resolved for that cutoff.
//
// It carries no database handle: reading is the RiskDataSource's job, passed
// to a calculation alongside this context. That split is what keeps "what is
// being evaluated" readable on its own and makes a context trivial to build
// in a test.

export type EvaluationRun = Readonly<{
    runId: number;
    dataAsOf: string;
    subjects: readonly string[] | null;
}>;

export class EvaluationContext {
    readonly runId: number;
    readonly dataAsOf: string;
    readonly subjects: readonly string[] | null;
    readonly parameters: readonly ParameterEntry<unknown>[];

    constructor(run: EvaluationRun, parameters: readonly ParameterEntry<unknown>[]) {
        this.runId = run.runId;
        this.dataAsOf = run.dataAsOf;
        this.subjects = run.subjects;
        this.parameters = parameters;
        Object.freeze(this);
    }

    // True for a backfill or a single-procurement rerun, false for a normal
    // full run — the distinction indicators and logs care about.
    get isScoped(): boolean {
        return this.subjects !== null;
    }
}
