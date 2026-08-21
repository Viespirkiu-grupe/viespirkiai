import { z } from "zod";
import type { ParameterEntry } from "../../types.ts";

// The effective-dated parameter timeline. See
// docs/indicators-story/risk-service-architecture.md §7.3.

export const ltCom03ParametersSchema = z.object({
    minimumSuppliers: z.number().int().positive(),
});

export type LtCom03Parameters = z.infer<typeof ltCom03ParametersSchema>;

export const ltCom03Parameters: readonly ParameterEntry<LtCom03Parameters>[] = [
    {
        validFrom: "2026-01-01",
        validTo: null,
        // Unscoped: scope: {} admits every method. See README.md, "Open
        // question: method scope".
        scope: {},
        values: { minimumSuppliers: 2 },
        source:
            "STT corruption-risk analyses (STT-I02, only one supplier consulted or invited): the catalogue's own " +
            "framing names exactly one supplier as the flagged case, so the threshold is the smallest integer that " +
            "excludes it — a procurement with fewer than two distinct suppliers recorded across every lot.",
    },
];
