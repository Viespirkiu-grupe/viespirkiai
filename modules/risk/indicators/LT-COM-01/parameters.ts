import { z } from "zod";
import type { ParameterEntry } from "../../types.ts";

// The effective-dated parameter timeline. See
// docs/indicators-story/risk-service-architecture-v2.md §3.4.

export const ltCom01ParametersSchema = z.object({
    maximumValidBids: z.number().int().positive(),
});

export type LtCom01Parameters = z.infer<typeof ltCom01ParametersSchema>;

export const ltCom01Parameters: readonly ParameterEntry<LtCom01Parameters>[] = [
    {
        validFrom: "2026-01-01",
        validTo: null,
        // Unscoped: scope: {} admits every method. See README.md, "Scope".
        scope: {},
        values: { maximumValidBids: 1 },
        source: "OCP Red Flags in Public Procurement 2024 (OCP-R018), catalogue definition",
    },
];
