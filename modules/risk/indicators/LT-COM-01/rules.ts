import type { SubjectFacts, Decision } from "../../contracts.ts";
import type { LtCom01Parameters } from "./parameters.ts";

// LT-COM-01 — HOW IT DECIDES. One fact row from collect.sql plus the parameter
// values in force for it, in; one decision, out. No database, no clock, no
// indicator identity — SubjectFactsIndicator supplies all of that
// (risk-service-architecture.md §4.1).

// What collect.sql returns per lot, on top of the shared SubjectFacts columns.
export type LtCom01Facts = SubjectFacts &
    Readonly<{
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

    // The lot's own ATN-1 row exists — that is where totalBids came from —
    // but without a matching procurement we cannot say which register it
    // belongs to, so the signal would not be attributable to anything.
    if (facts.procurementSource === null) {
        return { state: "insufficient_data", evidence, missingData: ["procurementSource"] };
    }

    // A report listing no participants at all is an incomplete report, not a
    // competition that nobody entered.
    if (facts.totalBids === 0) {
        return { state: "insufficient_data", evidence, missingData: ["tiekejoKodas"] };
    }

    return {
        state: facts.validBids <= parameters.maximumValidBids ? "triggered" : "not_triggered",
        rawValue: { totalBids: facts.totalBids, validBids: facts.validBids },
        threshold: { maximumValidBids: parameters.maximumValidBids },
        evidence,
    };
}
