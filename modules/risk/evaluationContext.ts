import type { ParameterEntry } from "./types.ts";

// One run's inputs, as a value object: the run id, the data_as_of cutoff,
// the subject set, and the parameter entries resolved for that cutoff. See
// riskDataSource.ts and docs/indicators-story/risk-service-architecture.md §5.

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

    // True when subjects is non-null.
    get isScoped(): boolean {
        return this.subjects !== null;
    }
}
