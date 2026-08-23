import { z } from "zod";
import type { ProcurementRiskDecisions, RiskSignal, RuntimeContract } from "./types.ts";

// Runtime validation for the Procurement Risk Service: zod schemas and the
// RuntimeContract wrapper around them. Types live in types.ts. See
// docs/indicators-story/risk-service-architecture-v2.md §3.4.

export function zodContract<T>(schema: z.ZodType<T>): RuntimeContract<T> {
    return Object.freeze({
        validate(value: unknown): T {
            return schema.parse(value);
        },
    });
}

export const riskSignalSchema: z.ZodType<RiskSignal> = z.object({
    indicatorId: z.string().regex(/^LT-/),
    indicatorVersion: z.number().int().positive(),
    subjectType: z.enum(["procurement", "lot", "bid", "contract", "supplier"]),
    subjectKey: z.string().min(1),
    state: z.enum(["triggered", "not_triggered", "insufficient_data", "not_applicable"]),
    rawValue: z.record(z.string(), z.unknown()).nullable(),
    threshold: z.record(z.string(), z.unknown()).nullable(),
    appliedParameters: z.record(z.string(), z.unknown()).nullable(),
    missingData: z.array(z.string()),
    dataAsOf: z.string(),
});

export const riskSignalContract: RuntimeContract<RiskSignal> = zodContract(riskSignalSchema);

export const procurementRiskDecisionsSchema: z.ZodType<ProcurementRiskDecisions> = z.object({
    procurementSource: z.string().min(1),
    procurementId: z.string().min(1),
    runId: z.number().int().positive(),
    signals: z.array(riskSignalSchema),
    dataAsOf: z.string(),
    createdAt: z.date(),
    updatedAt: z.date(),
});

export const procurementRiskDecisionsContract: RuntimeContract<ProcurementRiskDecisions> = zodContract(
    procurementRiskDecisionsSchema,
);
