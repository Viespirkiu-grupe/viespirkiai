import { z } from "zod";
import type { ParameterEntry } from "../../contracts.ts";

// The effective-dated parameter timeline. Append entries; close them with
// validTo; never rewrite one. A git diff of this file is the complete history
// of who changed the threshold or its scope, when, and why — see
// docs/indicators-story/risk-service-architecture.md §7.3.

export const ltCom01ParametersSchema = z.object({
    maximumValidBids: z.number().int().positive(),
});

export type LtCom01Parameters = z.infer<typeof ltCom01ParametersSchema>;

export const ltCom01Parameters: readonly ParameterEntry<LtCom01Parameters>[] = [
    {
        validFrom: "2026-01-01",
        validTo: null,
        // Unscoped, so every ATN-1 report method is covered, pending the
        // competitive/direct split — README.md, "Open question: method scope".
        scope: {},
        values: { maximumValidBids: 1 },
        source: "OCP Red Flags in Public Procurement 2024 (OCP-R018), catalogue definition",
    },
];
