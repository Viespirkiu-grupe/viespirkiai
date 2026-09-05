export class EvaluationContext {
    readonly dataAsOf: string;

    constructor(run: Readonly<{ dataAsOf: string }>) {
        this.dataAsOf = run.dataAsOf;
        Object.freeze(this);
    }
}
