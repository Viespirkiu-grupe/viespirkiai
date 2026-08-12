import { z } from "zod";
import { zodContract, type ParameterEntry } from "../../contracts.ts";

// The effective-dated parameter timeline. Append entries; close them with
// validTo. A git diff of this file is the complete history of "who changed
// the method scope, when, and why" — see
// docs/indicators-story/risk-service-architecture.md §10.2.

export const ltCom01ParametersSchema = z.object({
    requireCompetitiveMethod: z.boolean(),
});

export type LtCom01Parameters = z.infer<typeof ltCom01ParametersSchema>;

export const ltCom01ParametersContract = zodContract(ltCom01ParametersSchema);

export const ltCom01Parameters: readonly ParameterEntry<LtCom01Parameters>[] = [
    {
        validFrom: "2026-01-01",
        validTo: null,
        // No method restriction yet: applies to every ATN-1 report method.
        // Narrowing to competitive-only methods (excluding e.g. direct
        // negotiated awards to a single pre-chosen supplier) is a follow-up
        // parameter entry once the pirkimoBudas split between competitive
        // and direct-award methods is confirmed against real data — see
        // modules/viesiejiPirkimai/viesiejiPirkimaiEnums.js's PIRKIMO_BUDAS.
        scope: {},
        values: { requireCompetitiveMethod: false },
        source: "demonstration value pending review",
        note: "v1 placeholder — applies to every method until the competitive/direct split is confirmed.",
    },
];
