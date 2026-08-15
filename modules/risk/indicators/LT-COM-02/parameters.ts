import { z } from "zod";
import type { ParameterEntry } from "../../contracts.ts";

// The effective-dated parameter timeline. See
// docs/indicators-story/risk-service-architecture.md §7.3.

export const ltCom02ParametersSchema = z.object({
    minimumBidders: z.number().int().positive(),
});

export type LtCom02Parameters = z.infer<typeof ltCom02ParametersSchema>;

export const ltCom02Parameters: readonly ParameterEntry<LtCom02Parameters>[] = [
    {
        validFrom: "2026-01-01",
        validTo: null,
        // Unscoped: scope: {} admits every method. See README.md, "Open
        // question: method scope".
        scope: {},
        values: { minimumBidders: 3 },
        source:
            "OLAF fraud indicators for public procurement (OLAF-CN02, framework agreement with fewer than three " +
            "tenderers), cross-referenced against OCP-R019, OLAF-CA02, VPT-I12 in the catalogue: fewer than three " +
            "participating suppliers is the common low-competition threshold in the source literature.",
    },
];
