import type { Decision, SubjectFacts } from "../../contracts.ts";
import type { LtCom03Parameters } from "./parameters.ts";

// LT-COM-03 — HOW IT DECIDES. One fact row from collect.sql plus the parameter
// values in force for it, in; one decision, out. No database, no clock, no
// indicator identity — SubjectFactsIndicator supplies all of that
// (risk-service-architecture.md §4.1).

// What collect.sql returns per procurement, on top of the shared SubjectFacts
// columns.
export type LtCom03Facts = SubjectFacts &
    Readonly<{
        totalSuppliers: number;
        reportedAt: string | null;
    }>;

export function ltCom03Decide(facts: LtCom03Facts, parameters: LtCom03Parameters): Decision {
    const evidence = {
        pirkimoBudas: facts.method,
        ataskaitosData: facts.reportedAt,
        source: "ATN-1 ataskaita",
    };

    // The procurement's own ATN-1 row(s) exist — that is where totalSuppliers
    // came from — but without a matching procurement we cannot say which
    // register it belongs to, so the signal would not be attributable to
    // anything.
    if (facts.procurementSource === null) {
        return {
            state: "insufficient_data",
            evidence,
            missingData: ["procurementSource"],
        };
    }

    // A report listing no participants at all is an incomplete report, not a
    // procurement that nobody was invited to or consulted for.
    if (facts.totalSuppliers === 0) {
        return {
            state: "insufficient_data",
            evidence,
            missingData: ["tiekejoKodas"],
        };
    }

    return {
        state: facts.totalSuppliers < parameters.minimumSuppliers ? "triggered" : "not_triggered",
        rawValue: { totalSuppliers: facts.totalSuppliers },
        threshold: { minimumSuppliers: parameters.minimumSuppliers },
        evidence,
    };
}
