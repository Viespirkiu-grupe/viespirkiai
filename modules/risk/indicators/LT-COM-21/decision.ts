import type { BidSubject, RiskSignal } from "../../types.ts";
import { ABidIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltCom21Definition } from "./definition.ts";
import { citationsEqual, parseLegalBasisCitations, parseLegalBasisParameter } from "./legalBasis.ts";

// LT-COM-21 — Non-genuine, incomplete, or incapable bid: judges one
// supplier's individual bid, from the raw bid row the Procurement Reader
// already merged onto Subject.lot.bids (Bid, in types.ts). See
// docs/indicators-story/risk-service-architecture.md §1.2/§3.4 and
// docs/indicators-story/domain-model.md §1.1 ("v_dalyviai" subject entity).

export class LtCom21Decision extends ABidIndicatorDecision<typeof ltCom21Definition> {
    static readonly definition = ltCom21Definition;
    protected readonly missingDataWhenAbsent = ["eileNumeris", "atmetimoStatusas"];

    constructor(context: EvaluationContext) {
        super(ltCom21Definition, context);
    }

    // Mirrors LT-COM-20: only insufficient when the ATN-1 report's LATERAL
    // offer-detail join (v_dalyviai_v2.sql) found nothing at all for this
    // bidder — no ranking and no rejection outcome of any kind. A bid that
    // was ranked (eileNumeris present) is positively known not to have been
    // disqualified, even though atmetimoPriezastis is null for it — that is
    // not_triggered, not insufficient_data.
    protected hasRequiredData(subject: BidSubject): boolean {
        const { bid } = subject;
        return bid.eileNumeris !== null || bid.atmetimoStatusas !== null || bid.atmetimoPriezastis !== null;
    }

    // Parsed once per decision instance rather than per bid: the parameter
    // list is fixed for the life of the instance, and parseLegalBasisParameter
    // throws on an entry that spells no citation, so a typo in the list
    // fails the run rather than silently matching nothing.
    private readonly targetCitations = this.definition.parameters.nonGenuineIncompleteIncapableLegalBases.map(
        parseLegalBasisParameter,
    );

    assessRisk(subject: BidSubject): RiskSignal {
        const { bid } = subject;
        const { nonGenuineIncompleteIncapableLegalBases } = this.definition.parameters;

        const disqualified = bid.atmetimoPriezastis !== null;
        // The legal-basis field is free text in practice (see
        // legalBasis.ts), so the citations it spells are compared, not the
        // display string: "Viešųjų pirkimų įstatymo 45 str. 1 d. 1 p" (name
        // spelled out, no trailing stop) and "VPĮ 45 str. 1 d. 1 p." are
        // the same ground, while "VPĮ 45 str. 1 d. 5 p" — one character
        // away from a match under raw string comparison — is a price-based
        // rejection and stays not_triggered.
        const citations = disqualified ? parseLegalBasisCitations(bid.atmetimoTeisinisPagrindas) : [];
        const matchedLegalBasis =
            citations.find((cited) => this.targetCitations.some((target) => citationsEqual(cited, target))) ?? null;

        return this.signalFor(subject, {
            state: matchedLegalBasis !== null ? "triggered" : "not_triggered",
            rawValue: {
                atmetimoPriezastis: bid.atmetimoPriezastis,
                atmetimoTeisinisPagrindas: bid.atmetimoTeisinisPagrindas,
                matchedLegalBasis,
            },
            threshold: { nonGenuineIncompleteIncapableLegalBases },
            appliedParameters: { nonGenuineIncompleteIncapableLegalBases },
        });
    }
}
