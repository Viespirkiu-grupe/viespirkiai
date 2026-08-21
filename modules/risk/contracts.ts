import { z } from "zod";
import type { RiskSignal, RuntimeContract, SubjectFacts } from "./types.ts";

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

export const riskSignalContract: RuntimeContract<RiskSignal> = zodContract(riskSignalSchema);

export const subjectFactsSchema = z.looseObject({
    subjectKey: z.string().min(1),
    procurementSource: z.string().nullable(),
    procurementId: z.string().nullable(),
    method: z.string().nullish(),
    objectType: z.string().nullish(),
});

export const subjectFactsContract: RuntimeContract<SubjectFacts> = zodContract(subjectFactsSchema);
