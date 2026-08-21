import type { Decision, Subject } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import { ltCom03Definition } from "./definition.ts";
import type { LtCom03Parameters } from "./parameters.ts";

// LT-COM-03 — Only one supplier invited or consulted: judges a whole
// procurement from the cross-lot participation counts the Procurement Reader
// already merged onto Subject.procurement.participation. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4. Replaces
// rules.ts.

export class LtCom03Decision extends AProcurementIndicatorDecision<typeof ltCom03Definition> {
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor() {
        super(ltCom03Definition);
    }

    protected hasRequiredData(subject: Subject): boolean {
        return subject.subjectType === "procurement" && subject.procurement.participation !== null;
    }

    protected decide(subject: Subject, parameters: LtCom03Parameters): Decision {
        return LtCom03Decision.decide(subject, parameters);
    }

    static decide(subject: Subject, parameters: LtCom03Parameters): Decision {
        if (subject.subjectType !== "procurement") {
            throw new Error("LT-COM-03: expected a procurement subject");
        }
        const { procurement } = subject;
        // hasRequiredData already proved this is non-null.
        const participation = procurement.participation!;
        const evidence = {
            pirkimoBudas: procurement.pirkimoBudas,
            ataskaitosData: participation.reportedAt,
            source: "ATN-1 ataskaita",
        };

        // totalSuppliers === 0: a real, rarer case distinct from "no
        // participation observed" (hasRequiredData's null check) — a
        // participant row exists but every tiekejoKodas in it is NULL.
        // Treated as an incomplete report, not zero suppliers.
        if (participation.totalSuppliers === 0) {
            return {
                state: "insufficient_data",
                evidence,
                missingData: ["tiekejoKodas"],
            };
        }

        return {
            state: participation.totalSuppliers < parameters.minimumSuppliers ? "triggered" : "not_triggered",
            rawValue: { totalSuppliers: participation.totalSuppliers },
            threshold: { minimumSuppliers: parameters.minimumSuppliers },
            evidence,
        };
    }
}

export const ltCom03v1 = new LtCom03Decision();
