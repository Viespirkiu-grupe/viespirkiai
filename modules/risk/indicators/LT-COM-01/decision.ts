import type { Decision, Subject } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import { ltCom01Definition } from "./definition.ts";
import type { LtCom01Parameters } from "./parameters.ts";

// LT-COM-01 — Single valid bid: judges a lot from the participation counts
// the Procurement Reader already merged onto Subject.lot.participation. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4. Replaces
// rules.ts.

export class LtCom01Decision extends ALotIndicatorDecision<typeof ltCom01Definition> {
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor() {
        super(ltCom01Definition);
    }

    protected hasRequiredData(subject: Subject): boolean {
        return subject.subjectType === "lot" && subject.lot.participation !== null;
    }

    protected decide(subject: Subject, parameters: LtCom01Parameters): Decision {
        return LtCom01Decision.decide(subject, parameters);
    }

    static decide(subject: Subject, parameters: LtCom01Parameters): Decision {
        if (subject.subjectType !== "lot") {
            throw new Error("LT-COM-01: expected a lot subject");
        }
        const { lot, procurement } = subject;
        // hasRequiredData already proved this is non-null.
        const participation = lot.participation!;
        const evidence = {
            pirkimoBudas: procurement.pirkimoBudas,
            ataskaitosData: participation.reportedAt,
            source: "ATN-1 ataskaita",
        };

        // totalBids === 0: a real, rarer case distinct from "no participation
        // observed" (hasRequiredData's null check) — a participant row
        // exists but every tiekejoKodas in it is NULL. Treated as an
        // incomplete report, not zero participation.
        if (participation.totalBids === 0) {
            return {
                state: "insufficient_data",
                evidence,
                missingData: ["tiekejoKodas"],
            };
        }

        return {
            state: participation.validBids <= parameters.maximumValidBids ? "triggered" : "not_triggered",
            rawValue: { totalBids: participation.totalBids, validBids: participation.validBids },
            threshold: { maximumValidBids: parameters.maximumValidBids },
            evidence,
        };
    }
}

export const ltCom01v1 = new LtCom01Decision();
