import type { Decision } from "../../contracts.ts";
import type { LtCom02Parameters } from "./parameters.ts";

// LT-COM-02 — decide(): one supplemental fact row (from collect.sql) plus
// the parameter values in force for it, in; one Decision, out. See
// docs/indicators-story/risk-service-architecture-v2.md §3.4.

// What collect.sql returns per lot.
export type LtCom02Facts = Readonly<{
    pirkimoNumeris: string;
    daliesNumeris: string;
    method: string | null;
    totalBids: number;
    reportedAt: string | null;
}>;

export function ltCom02Decide(facts: LtCom02Facts, parameters: LtCom02Parameters): Decision {
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
        state: facts.totalBids < parameters.minimumBidders ? "triggered" : "not_triggered",
        rawValue: {totalBids: facts.totalBids},
        threshold: {minimumBidders: parameters.minimumBidders},
        evidence,
    };
}
