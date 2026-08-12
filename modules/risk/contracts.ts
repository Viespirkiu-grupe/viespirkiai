import { z } from "zod";

// Shared observation and run contracts for the Procurement Risk Service.
// Mirrors docs/indicators-story/risk-service-architecture.md §5.3.
//
// This file holds values only — the vocabulary every other risk module
// speaks. The behaviour that uses them lives with the object that owns it:
// riskIndicator.ts (one indicator version), sqlRiskIndicator.ts (the packaged
// SELECT case), evaluationContext.ts (what one run evaluates),
// riskDataSource.ts (how a calculation reaches the database).

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
