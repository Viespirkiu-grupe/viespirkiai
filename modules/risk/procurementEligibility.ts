import type { Lot, PartialRiskSignal, Procurement } from "./types.ts";

// The Procurement Eligibility Decision and its lot-level equivalent
// (docs/indicators-story/risk-service-architecture-v2.md §3.3): the shared
// gate every procurement/lot indicator's isEligible() starts from. Pure and
// synchronous — no database access, so it's directly unit-testable and safe
// to call from inside a subject loop.

export type EligibilityGate =
    | Readonly<{ eligible: true }>
    | Readonly<{ eligible: false; decision: PartialRiskSignal }>;

/**
 * Eligible when pirkimoBudas is present and saltinis is 'cvpis' (§3.3's
 * decision table). cvpp rows never carry pirkimoBudas (v_pirkimas.sql), so
 * they are the documented not-eligible case: not_applicable, not a data gap.
 *
 * Takes a non-null Procurement: the Procurement Reader drops orphan lots
 * before any Subject is built (types.ts's LotSubject comment), and a
 * ProcurementSubject's own procurement was never nullable, so both callers
 * (procurementLotDecision.ts) always have one to pass.
 */
export function procurementEligibility(procurement: Procurement): EligibilityGate {
    if (procurement.saltinis === "cvpis" && procurement.pirkimoBudas !== null) {
        return { eligible: true };
    }
    return { eligible: false, decision: { state: "not_applicable" } };
}

/**
 * No lot-specific narrowing exists yet — delegates entirely to its parent
 * procurement's gate. Extend THIS function (not procurementEligibility
 * above) when a lot-level indicator needs its own rule, per
 * risk-service-architecture-v2.md §5's answered open question #1 ("you will
 * extend DRD on demand").
 */
export function lotEligibility(_lot: Lot, procurement: Procurement): EligibilityGate {
    return procurementEligibility(procurement);
}
