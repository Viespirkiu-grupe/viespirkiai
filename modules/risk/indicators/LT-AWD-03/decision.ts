import type { Bid, LotSubject, RiskSignal } from "../../types.ts";
import { ALotIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltAwd03Definition } from "./definition.ts";

// LT-AWD-03 — Poorly supported disqualification: reads Subject.lot.bids (per-bid
// rejection reason and legal basis), the same LOT_BIDS_SQL shape LT-AWD-02
// already reads. See docs/indicators-story/risk-service-architecture-v2.md
// §1.2/§3.4.

function isDisqualified(bid: Bid): boolean {
    return bid.atmetimoPriezastis !== null;
}

export class LtAwd03Decision extends ALotIndicatorDecision<typeof ltAwd03Definition> {
    static readonly definition = ltAwd03Definition;
    protected readonly missingDataWhenAbsent = ["tiekejoKodas"];

    constructor(context: EvaluationContext) {
        super(ltAwd03Definition, context);
    }

    protected hasRequiredData(subject: LotSubject): boolean {
        return subject.lot.participation !== null;
    }

    assessRisk(subject: LotSubject): RiskSignal {
        const { lot } = subject;
        const { weakLegalBases } = this.definition.parameters;

        // No per-bid rows at all — the same "report lists no usable
        // participants" gap LT-AWD-01/LT-AWD-02 handle for their own shapes.
        if (lot.bids.length === 0) {
            return this.signalFor(subject, {
                state: "insufficient_data",
                missingData: ["atmetimoPriezastis"],
            });
        }

        const disqualifiedBids = lot.bids.filter(isDisqualified);
        const poorlySupportedBids = disqualifiedBids.filter(
            (bid) => bid.atmetimoTeisinisPagrindas === null || weakLegalBases.includes(bid.atmetimoTeisinisPagrindas),
        );

        const triggered = poorlySupportedBids.length > 0;
        return this.signalFor(subject, {
            state: triggered ? "triggered" : "not_triggered",
            rawValue: {
                disqualifiedBids: disqualifiedBids.length,
                poorlySupportedBids: poorlySupportedBids.length,
            },
            threshold: { weakLegalBases },
            appliedParameters: { weakLegalBases },
        });
    }
}
