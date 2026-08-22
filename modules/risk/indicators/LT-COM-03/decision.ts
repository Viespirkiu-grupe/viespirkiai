import type { RiskSignal, Subject } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltCom03Definition } from "./definition.ts";

// LT-COM-03 — Only one supplier invited or consulted: judges a whole
// procurement from the cross-lot participation counts the Procurement Reader
// already merged onto Subject.procurement.participation. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4.

export class LtCom03Decision extends AProcurementIndicatorDecision<typeof ltCom03Definition> {
    static readonly definition = ltCom03Definition;
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor(context: EvaluationContext) {
        super(ltCom03Definition, context);
    }

    protected hasRequiredData(subject: Subject): boolean {
        return subject.subjectType === "procurement" && subject.procurement.participation !== null;
    }

    assessRisk(subject: Subject, context: EvaluationContext): RiskSignal {
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

        const entry = this.parameterEntryFor(context.dataAsOf);
        if (entry === null) {
            return this.signalFor(subject, context, { state: "not_applicable" });
        }

        // totalSuppliers === 0: a real, rarer case distinct from "no
        // participation observed" (hasRequiredData's null check) — a
        // participant row exists but every tiekejoKodas in it is NULL.
        // Treated as an incomplete report, not zero suppliers.
        if (participation.totalSuppliers === 0) {
            return this.signalFor(subject, context, {
                state: "insufficient_data",
                evidence,
                missingData: ["tiekejoKodas"],
            });
        }

        const { minimumSuppliers } = entry;
        return this.signalFor(subject, context, {
            state: participation.totalSuppliers < minimumSuppliers ? "triggered" : "not_triggered",
            rawValue: { totalSuppliers: participation.totalSuppliers },
            threshold: { minimumSuppliers },
            evidence,
            appliedParameters: { minimumSuppliers },
        });
    }
}
