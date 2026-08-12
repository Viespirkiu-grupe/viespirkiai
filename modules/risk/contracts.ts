import { z } from "zod";
import { loadPackagedSql } from "./sqlLoader.ts";

// Shared observation and run contracts for the Procurement Risk Service.
// Mirrors docs/indicators-story/risk-service-architecture.md §5.3.

export type IndicatorLifecycle = "draft" | "shadow" | "active" | "retired";
export type IndicatorStage = "planning" | "tender" | "award" | "contract";
export type SubjectType = "procurement" | "lot" | "contract" | "supplier";

// The four states a calculation returns.
export type IndicatorState = "triggered" | "not_triggered" | "insufficient_data" | "not_applicable";

// The state stored in risk.risk_signals: the four above, plus the one the
// run job records on behalf of a calculation that failed.
export type SignalState = IndicatorState | "calculation_error";

export type RuntimeContract<T> = Readonly<{
    validate(value: unknown): T;
}>;

export function zodContract<T>(schema: z.ZodType<T>): RuntimeContract<T> {
    return Object.freeze({
        validate(value: unknown): T {
            return schema.parse(value);
        },
    });
}

// Canonical catalogue identity, e.g. { id: 'LT-PRO-08', version: 2 }.
export type RiskIndicatorKey = Readonly<{
    id: `LT-${string}`;
    version: number;
}>;

export const riskObservationV1Schema = z.object({
    indicatorId: z.string().regex(/^LT-/),
    indicatorVersion: z.number().int().positive(),
    subjectType: z.enum(["procurement", "lot", "contract", "supplier"]),
    subjectKey: z.string().min(1),
    procurementSource: z.string().nullable(),
    procurementId: z.string().nullable(),
    state: z.enum(["triggered", "not_triggered", "insufficient_data", "not_applicable"]),
    rawValue: z.record(z.string(), z.unknown()).nullable(),
    threshold: z.record(z.string(), z.unknown()).nullable(),
    appliedParameters: z.record(z.string(), z.unknown()).nullable(),
    evidence: z.record(z.string(), z.unknown()),
    missingData: z.array(z.string()),
    dataAsOf: z.string(),
});

export type RiskObservationV1 = z.infer<typeof riskObservationV1Schema>;

export const riskObservationV1Contract: RuntimeContract<RiskObservationV1> = zodContract(riskObservationV1Schema);

// One effective-dated entry of a parameter timeline. Appending an entry is
// the way a threshold changes; entries are immutable once merged.
export type ParameterEntry<P> = Readonly<{
    validFrom: string;
    validTo: string | null;
    scope: Readonly<{
        methods?: readonly string[];
        objectTypes?: readonly string[];
    }>;
    values: P;
    source: string;
    note?: string;
}>;

// The evaluation context is the way a calculation reaches data. `sql` runs a
// SQL statement packaged in the indicator's own directory (already loaded via
// sqlLoader.ts's `loadPackagedSql`, keyed by the caller's own import.meta.url
// so relative paths resolve against that indicator's directory) on the
// read-only connection, inside the run job's read-only transaction and
// statement timeout.
export type EvaluationContext = Readonly<{
    runId: number;
    dataAsOf: string;
    parameters: readonly ParameterEntry<unknown>[];
    subjects: readonly string[] | null;

    // @Todo: this method is not context responsibility, find another way. Use best OOP practices and separation of concerns.
    sql<T>(sqlText: string, params?: readonly unknown[]): Promise<readonly T[]>;
}>;

// One contract, whatever the calculation is made of.
// @Todo: this should be an abstract method of RiskIndicator.
export type Calculation = (ctx: EvaluationContext) => Promise<readonly RiskObservationV1[]>;

// @Todo: I'm skeptical having RiskIndicator as a type - it seems like a class would be more appropriate, with methods for calculation and validation. Also, you can manage reading by getters or readonly declarations
export type RiskIndicator<P> = Readonly<{
    key: RiskIndicatorKey;
    lifecycle: IndicatorLifecycle;
    subjectType: SubjectType;
    stage: IndicatorStage;
    references: readonly string[];
    sourceRelations: readonly string[];
    requiredInputs: readonly string[];
    parameters: readonly ParameterEntry<P>[];
    parameterContract: RuntimeContract<P>;
    calculation: Calculation;
    outputContract: RuntimeContract<RiskObservationV1>;
    standard: Readonly<{ name: string; url: string; page?: number }>;
    public: Readonly<{
        titleLt: string;
        descriptionLt: string;
        formulaLt: string;
        limitationLt: string;
    }>;
}>;

export type RiskIndicatorInput<P> = Readonly<
    Omit<RiskIndicator<P>, "calculation" | "outputContract"> & {
        calculation: Calculation | Readonly<{ sqlFile: string }>;
        outputContract?: RuntimeContract<RiskObservationV1>;
    }
>;

/**
 * Freezes and validates one Risk Indicator definition. Expands the
 * `{ sqlFile }` shorthand into `(ctx) => ctx.sql(file)`, resolved relative to
 * the caller's own directory — pass `import.meta.url` from `definition.ts`.
 */
export function defineRiskIndicator<P>(def: RiskIndicatorInput<P>, definitionUrl: string): RiskIndicator<P> {
    if (!def.key.id.startsWith("LT-")) {
        throw new Error(`Risk Indicator id must start with 'LT-': ${def.key.id}`);
    }
    if (!def.public.titleLt || !def.public.limitationLt) {
        throw new Error(`Risk Indicator ${def.key.id}: public.titleLt and public.limitationLt must be non-empty`);
    }
    for (const entry of def.parameters) {
        def.parameterContract.validate(entry.values);
    }

    // @Todo: below code is confusing and messy. Maybe it would be better to use OOP practices such as an interface and an instance that either calculates, or executes sql or even both if needed.
    const calculation: Calculation =
        typeof def.calculation === "function"
            ? def.calculation
            : (ctx) => {
                  const sql = loadPackagedSql(definitionUrl, (def.calculation as { sqlFile: string }).sqlFile);
                  return ctx.sql(sql, [ctx.runId, ctx.dataAsOf, JSON.stringify(ctx.parameters), ctx.subjects]);
              };

    return Object.freeze({
        ...def,
        calculation,
        outputContract: def.outputContract ?? riskObservationV1Contract,
    });
}
