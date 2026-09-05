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
 * decision table). cvpp rows never carry pirkimoBudas, so they are the
 * documented not-eligible case: not_applicable, not a data gap.
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
 * above) when a lot-level indicator needs its own rule.
 */
export function lotEligibility(_lot: Lot, procurement: Procurement): EligibilityGate {
    return procurementEligibility(procurement);
}
