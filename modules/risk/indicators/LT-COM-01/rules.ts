import type { Decision } from "../../contracts.ts";
import type { LtCom01Parameters } from "./parameters.ts";

// LT-COM-01 — decide(): one supplemental fact row (from collect.sql) plus
// the parameter values in force for it, in; one Decision, out. See
// docs/indicators-story/risk-service-architecture-v2.md §3.4.

// What collect.sql returns per lot.
export type LtCom01Facts = Readonly<{
    pirkimoNumeris: string;
    daliesNumeris: string;
    method: string | null;
    totalBids: number;
    validBids: number;
    reportedAt: string | null;
}>;

export function ltCom01Decide(facts: LtCom01Facts, parameters: LtCom01Parameters): Decision {
    const evidence = {
        pirkimoBudas: facts.method,
        ataskaitosData: facts.reportedAt,
        source: "ATN-1 ataskaita",
    };

    // totalBids === 0: treated as an incomplete report, not zero participation.
    if (facts.totalBids === 0) {
        return {
            state: "insufficient_data",
            evidence,
            missingData: ["tiekejoKodas"]
        };
    }

    return {
        state: facts.validBids <= parameters.maximumValidBids ? "triggered" : "not_triggered",
        rawValue: {totalBids: facts.totalBids, validBids: facts.validBids},
        threshold: {maximumValidBids: parameters.maximumValidBids},
        evidence,
    };
}
