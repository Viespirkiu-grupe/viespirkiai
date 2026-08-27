import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-AWD-01 — All bids except winner disqualified (Visi pasiūlymai, išskyrus laimėtojo, atmesti).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtAwd01Parameters extends BaseParameters {
    // A lot must have received at least this many bids for a single
    // survivor to mean "the rest got disqualified" rather than "only one
    // bid was ever submitted" (LT-COM-01's concern, not this one's).
    readonly minimumTotalBids: number;
    // Exactly this many bids must remain valid (not disqualified) for the
    // survivor(s) to stand in as "the winner" — not fewer (that would mean
    // every bid, including any winner, was disqualified: total failure, not
    // "all but the winner"), not more. Kept as a parameter rather than a
    // literal `1`, mirroring LT-COM-01's maximumValidBids.
    readonly survivingValidBids: number;
}

export const ltAwd01Definition: RiskIndicatorDefinition<LtAwd01Parameters> = {
    key: { id: "LT-AWD-01", version: 1 },
    subjectType: "lot",
    stage: "award",
    references: ["OCP-R035", "OT-I11"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "atmetimoPriezastis"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        minimumTotalBids: 2,
        survivingValidBids: 1,
        source: "OCP Red Flags in Public Procurement 2024 (OCP-R035, 'All bids except the winning bid disqualified'), " +
            "catalogue definition",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Visi pasiūlymai, išskyrus laimėtojo, atmesti",
        descriptionLt:
            "Pirkimo dalyje dalyvavo keli tiekėjai, tačiau po pasiūlymų vertinimo tinkamu (neatmestu) liko tik " +
            "vienas pasiūlymas — visi kiti buvo atmesti.",
        formulaLt: "pateiktų pasiūlymų skaičius ≥ taikoma riba IR tinkamų pasiūlymų skaičius (po atmetimų) = taikoma riba",
        limitationLt:
            "Rodiklis nevertina, ar atmetimai buvo teisėti ar nepagrįsti (tam žr. LT-AWD-03 „Nepakankamai pagrįstas " +
            "atmetimas“) — jis tik fiksuoja, kad konkurencija dalyje faktiškai buvo sumažinta iki vieno tiekėjo, nors " +
            "pasiūlymų buvo pateikta daugiau. Skiriasi nuo LT-COM-01 „Vienintelis tinkamas pasiūlymas“, kuris suveikia " +
            "ir tada, kai iš pat pradžių buvo gautas tik vienas pasiūlymas.",
    },
};
