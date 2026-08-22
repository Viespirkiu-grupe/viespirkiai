export class EvaluationContext {
    readonly runId: number;
    readonly dataAsOf: string;

    constructor(run: Readonly<{ runId: number; dataAsOf: string }>) {
        this.runId = run.runId;
        this.dataAsOf = run.dataAsOf;
        Object.freeze(this);
    }
}
