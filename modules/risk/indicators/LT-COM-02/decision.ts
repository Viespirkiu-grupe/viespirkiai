import type { Decision, Subject } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import { ltCom02Definition } from "./definition.ts";
import type { LtCom02Parameters } from "./parameters.ts";

// LT-COM-02 — Low number of bidders: one supplemental fact row (from
// collect.sql) plus the parameter values in force for it, in; one Decision,
// out. See docs/indicators-story/risk-service-architecture-v2.md §3.4.
// Replaces rules.ts.

// What collect.sql returns per lot.
export type LtCom02Facts = Readonly<{
    pirkimoNumeris: string;
    daliesNumeris: string;
    method: string | null;
    totalBids: number;
    reportedAt: string | null;
}>;

export class LtCom02Decision extends ALotIndicatorDecision<LtCom02Facts, typeof ltCom02Definition> {
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor() {
        super(ltCom02Definition, import.meta.url, "./collect.sql");
    }

    protected factKey(row: LtCom02Facts): string {
        return `${row.pirkimoNumeris}:${row.daliesNumeris}`;
    }

    protected subjectKey(subject: Subject): string {
        return subject.subjectType === "lot" ? `${subject.lot.pirkimoNumeris}:${subject.lot.daliesNumeris}` : "";
    }

    protected methodOf(row: LtCom02Facts): string | null {
        return row.method;
    }

    protected decide(_subject: Subject, facts: LtCom02Facts, parameters: LtCom02Parameters): Decision {
        return LtCom02Decision.decide(facts, parameters);
    }

    static decide(facts: LtCom02Facts, parameters: LtCom02Parameters): Decision {
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
            state: facts.totalBids < parameters.minimumBidders ? "triggered" : "not_triggered",
            rawValue: { totalBids: facts.totalBids },
            threshold: { minimumBidders: parameters.minimumBidders },
            evidence,
        };
    }
}

export const ltCom02v1 = new LtCom02Decision();
