import { z } from "zod";
import { zodContract, type ParameterEntry } from "../../contracts.ts";

// The effective-dated parameter timeline. Append entries; close them with
// validTo. A git diff of this file is the complete history of "who changed
// the threshold or its scope, when, and why" — see
// docs/indicators-story/risk-service-architecture.md §10.2.

export const ltCom01ParametersSchema = z.object({
    // The number of surviving bids at or below which the lot triggers. One is
    // the catalogue definition; the parameter exists because a reviewer may
    // later argue that two bids in a market with three suppliers is the same
    // signal, and that argument should be an entry rather than a new version.
    maximumValidBids: z.number().int().positive(),
});

export type LtCom01Parameters = z.infer<typeof ltCom01ParametersSchema>;

export const ltCom01ParametersContract = zodContract(ltCom01ParametersSchema);

export const ltCom01Parameters: readonly ParameterEntry<LtCom01Parameters>[] = [
    {
        validFrom: "2026-01-01",
        validTo: null,
        // Unscoped: applies to every ATN-1 report method. Narrowing to
        // competitive methods only — excluding e.g. direct negotiated awards
        // to a single pre-chosen supplier, where one surviving bid is the
        // procedure working as intended — means appending an entry with
        // scope.methods, and a second entry covering the remaining methods or
        // none at all, in which case those lots become not_applicable. See
        // modules/viesiejiPirkimai/viesiejiPirkimaiEnums.js's PIRKIMO_BUDAS
        // and README.md.
        scope: {},
        values: { maximumValidBids: 1 },
        source: "demonstration value pending review",
        note: "v1 placeholder — applies to every method until the competitive/direct split is confirmed.",
    },
];
