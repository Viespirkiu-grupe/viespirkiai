import type { Decision } from "../../contracts.ts";
import type { LtCom03Parameters } from "./parameters.ts";

// LT-COM-03 — decide(): one supplemental fact row (from collect.sql) plus
// the parameter values in force for it, in; one Decision, out. See
// docs/indicators-story/risk-service-architecture-v2.md §3.4.

// What collect.sql returns per procurement.
export type LtCom03Facts = Readonly<{
    pirkimoNumeris: string;
    method: string | null;
    totalSuppliers: number;
    reportedAt: string | null;
}>;

export function ltCom03Decide(facts: LtCom03Facts, parameters: LtCom03Parameters): Decision {
    const evidence = {
        pirkimoBudas: facts.method,
        ataskaitosData: facts.reportedAt,
        source: "ATN-1 ataskaita",
    };

    // totalSuppliers === 0: treated as an incomplete report, not zero suppliers.
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
