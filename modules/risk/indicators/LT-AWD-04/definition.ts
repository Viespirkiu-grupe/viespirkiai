import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-AWD-04 — Excessive share of disqualified bids (Neproporcingai didelė
// atmestų pasiūlymų dalis).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtAwd04Parameters extends BaseParameters {
    // Minimum totalBids for "share" to be a meaningful ratio at all — below
    // this, one disqualification already swings the share by a large step.
    readonly minimumTotalBids: number;
    // Fraction of totalBids that must be disqualified (1 - validBids/totalBids)
    // for the lot to trigger.
    readonly disqualifiedShareThreshold: number;
}

export const ltAwd04Definition: RiskIndicatorDefinition<LtAwd04Parameters> = {
    key: { id: "LT-AWD-04", version: 1 },
    subjectType: "lot",
    stage: "award",
    references: ["OCP-R038"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "atmetimoPriezastis"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        minimumTotalBids: 3,
        disqualifiedShareThreshold: 0.5,
        source:
            "OCP Red Flags in Public Procurement 2024 (OCP-R038, 'Excessive disqualified bids'), catalogue " +
            "definition. The catalogue booklet names the concept without a numeric threshold; a majority " +
            "(>= 50%) of a lot's distinct bidders disqualified, among lots with at least 3 bidders (below " +
            "which one disqualification already swings the share by a large step), is the threshold chosen " +
            "here — a plain 'more disqualified than survived' reading of 'excessive'. Measured against the " +
            "live warehouse (2026-08-27 snapshot): of 4,319 lots with >= 3 recorded bidders, 1,098 (25.4%) " +
            "meet this threshold.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Neproporcingai didelė atmestų pasiūlymų dalis",
        descriptionLt:
            "Pirkimo dalyje, kurioje dalyvavo pakankamai tiekėjų, dauguma (pusė ar daugiau) jų pasiūlymų buvo " +
            "atmesta.",
        formulaLt:
            "dalyvių skaičius (totalBids) ≥ taikoma riba IR atmestų pasiūlymų dalis " +
            "((totalBids − validBids) / totalBids) ≥ taikoma riba",
        limitationLt:
            "Didelė atmetimų dalis gali būti paaiškinama teisėtomis priežastimis — griežtais, bet pagrįstais " +
            "kvalifikaciniais reikalavimais arba tiekėjų klaidomis ruošiant pasiūlymus. Rodiklis nevertina " +
            "kiekvieno atmetimo pagrindo pagrįstumo (tam skirtas LT-AWD-03) ir gali sutapti su LT-AWD-01, kai " +
            "atmetus daugumą pasiūlymų liko lygiai vienas laimėtojas.",
    },
};
