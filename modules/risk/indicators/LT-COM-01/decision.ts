import type { Decision, Subject } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import { ltCom01Definition } from "./definition.ts";
import type { LtCom01Parameters } from "./parameters.ts";

// LT-COM-01 — Single valid bid: one supplemental fact row (from collect.sql)
// plus the parameter values in force for it, in; one Decision, out. See
// docs/indicators-story/risk-service-architecture-v2.md §3.4. Replaces
// rules.ts.

// What collect.sql returns per lot.
export type LtCom01Facts = Readonly<{
    pirkimoNumeris: string;
    daliesNumeris: string;
    method: string | null;
    totalBids: number;
    validBids: number;
    reportedAt: string | null;
}>;

export class LtCom01Decision extends ALotIndicatorDecision<LtCom01Facts, typeof ltCom01Definition> {
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor() {
        super(ltCom01Definition, import.meta.url, "./collect.sql");
    }

    protected factKey(row: LtCom01Facts): string {
        return `${row.pirkimoNumeris}:${row.daliesNumeris}`;
    }

    protected subjectKey(subject: Subject): string {
        return subject.subjectType === "lot" ? `${subject.lot.pirkimoNumeris}:${subject.lot.daliesNumeris}` : "";
    }

    protected methodOf(row: LtCom01Facts): string | null {
        return row.method;
    }

    protected decide(_subject: Subject, facts: LtCom01Facts, parameters: LtCom01Parameters): Decision {
        return LtCom01Decision.decide(facts, parameters);
    }

    static decide(facts: LtCom01Facts, parameters: LtCom01Parameters): Decision {
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
                missingData: ["tiekejoKodas"],
            };
        }

        return {
            state: facts.validBids <= parameters.maximumValidBids ? "triggered" : "not_triggered",
            rawValue: { totalBids: facts.totalBids, validBids: facts.validBids },
            threshold: { maximumValidBids: parameters.maximumValidBids },
            evidence,
        };
    }
}

export const ltCom01v1 = new LtCom01Decision();
