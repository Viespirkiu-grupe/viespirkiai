import type { Decision, Subject } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import { ltCom03Definition } from "./definition.ts";
import type { LtCom03Parameters } from "./parameters.ts";

// LT-COM-03 — Only one supplier invited or consulted: one supplemental fact
// row (from collect.sql) plus the parameter values in force for it, in; one
// Decision, out. See
// docs/indicators-story/risk-service-architecture-v2.md §3.4. Replaces
// rules.ts.

// What collect.sql returns per procurement.
export type LtCom03Facts = Readonly<{
    pirkimoNumeris: string;
    method: string | null;
    totalSuppliers: number;
    reportedAt: string | null;
}>;

export class LtCom03Decision extends AProcurementIndicatorDecision<LtCom03Facts, typeof ltCom03Definition> {
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor() {
        super(ltCom03Definition, import.meta.url, "./collect.sql");
    }

    protected factKey(row: LtCom03Facts): string {
        return row.pirkimoNumeris;
    }

    protected subjectKey(subject: Subject): string {
        return subject.subjectType === "procurement" ? subject.procurement.pirkimoNumeris : "";
    }

    protected methodOf(row: LtCom03Facts): string | null {
        return row.method;
    }

    protected decide(_subject: Subject, facts: LtCom03Facts, parameters: LtCom03Parameters): Decision {
        return LtCom03Decision.decide(facts, parameters);
    }

    static decide(facts: LtCom03Facts, parameters: LtCom03Parameters): Decision {
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
}

export const ltCom03v1 = new LtCom03Decision();
