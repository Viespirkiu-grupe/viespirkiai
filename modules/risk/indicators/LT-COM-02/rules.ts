import type {Decision, SubjectFacts} from "../../contracts.ts";
import type {LtCom02Parameters} from "./parameters.ts";

// LT-COM-02 — decide(): one fact row (from collect.sql) plus the parameter
// values in force for it, in; one Decision, out. See
// docs/indicators-story/risk-service-architecture.md §4.1.

// What collect.sql returns per lot, on top of the shared SubjectFacts columns.
export type LtCom02Facts = SubjectFacts &
    Readonly<{
        totalBids: number;
        reportedAt: string | null;
    }>;

export function ltCom02Decide(facts: LtCom02Facts, parameters: LtCom02Parameters): Decision {
    const evidence = {
        pirkimoBudas: facts.method,
        ataskaitosData: facts.reportedAt,
        source: "ATN-1 ataskaita",
    };

    // procurementSource is null: no matching procurement register.
    if (facts.procurementSource === null) {
        return {
            state: "insufficient_data",
            evidence,
            missingData: ["procurementSource"]
        };
    }

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
