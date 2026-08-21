import type { RiskSignal, Subject } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltCom01Definition } from "./definition.ts";

// LT-COM-01 — Single valid bid: judges a lot from the participation counts
// the Procurement Reader already merged onto Subject.lot.participation. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

export class LtCom01Decision extends ALotIndicatorDecision<typeof ltCom01Definition> {
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor() {
        super(ltCom01Definition);
    }

    protected hasRequiredData(subject: Subject): boolean {
        return subject.subjectType === "lot" && subject.lot.participation !== null;
    }

    assessRisk(subject: Subject, context: EvaluationContext): RiskSignal {
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

        const resolved = this.resolveParameters(subject, context);
        if (resolved === null) {
            return this.signalFor(subject, context, { state: "not_applicable" });
        }

        // totalBids === 0: a real, rarer case distinct from "no participation
        // observed" (hasRequiredData's null check) — a participant row
        // exists but every tiekejoKodas in it is NULL. Treated as an
        // incomplete report, not zero participation.
        if (participation.totalBids === 0) {
            return this.signalFor(subject, context, {
                state: "insufficient_data",
                evidence,
                missingData: ["tiekejoKodas"],
            });
        }

        const { maximumValidBids } = resolved.values;
        return this.signalFor(subject, context, {
            state: participation.validBids <= maximumValidBids ? "triggered" : "not_triggered",
            rawValue: { totalBids: participation.totalBids, validBids: participation.validBids },
            threshold: { maximumValidBids },
            evidence,
            appliedParameters: resolved.appliedParameters,
        });
    }
}

export const ltCom01v1 = new LtCom01Decision();
