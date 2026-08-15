import { z } from "zod";

// Shared observation and run contracts for the Procurement Risk Service. See
// docs/indicators-story/risk-service-architecture.md §4.3.
//
// This file holds types and values only. Behaviour lives in riskIndicator.ts,
// subjectFactsIndicator.ts, evaluationContext.ts, and riskDataSource.ts.

export type IndicatorLifecycle = "draft" | "shadow" | "active" | "retired";
export type IndicatorStage = "planning" | "tender" | "award" | "contract";
export type SubjectType = "procurement" | "lot" | "contract" | "supplier";

// The four states a calculation returns.
export type IndicatorState = "triggered" | "not_triggered" | "insufficient_data" | "not_applicable";

// The four IndicatorState values, plus "calculation_error".
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

// Which subjects an entry's values apply to; see parameterScope.ts and
// docs/indicators-story/risk-service-architecture.md §4.5.
export type ParameterScope = Readonly<{
    methods?: readonly string[];
    objectTypes?: readonly string[];
}>;

// One effective-dated entry of a parameter timeline. `validTo: null` means
// still in force.
//
// `source` and `note` are published verbatim with the entry
// (deployedIndicators.ts). `note` is optional.
export type ParameterEntry<P> = Readonly<{
    validFrom: string;
    validTo: string | null;
    scope: ParameterScope;
    values: P;
    source: string;
    note?: string;
}>;

// The columns every collect.sql returns, in addition to whatever else it
// measures. See subjectFactsIndicator.ts and
// docs/indicators-story/risk-service-architecture.md §4.1.
export type SubjectFacts = Readonly<{
    subjectKey: string;
    procurementSource: string | null;
    procurementId: string | null;
    // Read by scopeAdmits (parameterScope.ts) when a parameter entry
    // narrows this dimension.
    method?: string | null;
    objectType?: string | null;
}>;

export const subjectFactsSchema = z.looseObject({
    subjectKey: z.string().min(1),
    procurementSource: z.string().nullable(),
    procurementId: z.string().nullable(),
    method: z.string().nullish(),
    objectType: z.string().nullish(),
});

export const subjectFactsContract: RuntimeContract<SubjectFacts> = zodContract(subjectFactsSchema);

// The fields a decide() function returns; riskIndicator.ts and
// subjectFactsIndicator.ts assemble the rest of an observation around them.
export type Decision = Readonly<{
    state: IndicatorState;
    rawValue?: Readonly<Record<string, unknown>> | null;
    threshold?: Readonly<Record<string, unknown>> | null;
    evidence?: Readonly<Record<string, unknown>>;
    missingData?: readonly string[];
}>;
