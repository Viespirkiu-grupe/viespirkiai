import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-AWD-03 — Poorly supported disqualification (Nepakankamai pagrįstas atmetimas).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtAwd03Parameters extends BaseParameters {
    // Structured ATN-1 rejection legal-basis labels (xlsxPPAatmetimoTeisiniaiPagrindai.pavadinimas,
    // exposed as public.v_dalyviai_v2."atmetimoTeisinisPagrindas") that do not name a specific
    // statutory ground — a generic "Other" catch-all or the dropdown's own unfilled placeholder
    // text. A list, not a literal: the source dictionary can gain another such label without a new
    // indicator version.
    readonly weakLegalBases: readonly string[];
}

export const ltAwd03Definition: RiskIndicatorDefinition<LtAwd03Parameters> = {
    key: { id: "LT-AWD-03", version: 1 },
    subjectType: "lot",
    stage: "award",
    references: ["OCP-R037", "STT-I14"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "atmetimoPriezastis", "atmetimoTeisinisPagrindas"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        weakLegalBases: [
            "Kita",
            "kita",
            "Pasiūlymų (galutinių pasiūlymų) atmetimo teisiniai pagrindai (pasirinkti iš sąrašo)",
        ],
        source:
            "OCP Red Flags in Public Procurement 2024 (OCP-R037, 'Poorly supported disqualifications') and the " +
            "STT catalogue (STT-I14, 'Bid rejected on weak or inconsistent grounds'), matched against the ATN-1/PPA " +
            "procedure report's own structured rejection legal-basis dictionary " +
            "(xlsxPPAatmetimoTeisiniaiPagrindai) rather than the free-text rejection reason, which cannot be " +
            "tested against a closed vocabulary.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Nepakankamai pagrįstas atmetimas",
        descriptionLt:
            "Pirkimo dalyje bent vienas tiekėjo pasiūlymas buvo atmestas, tačiau ATN-1 (PPA) ataskaitoje " +
            "nenurodytas joks konkretus teisinis atmetimo pagrindas arba nurodytas tik bendro pobūdžio " +
            "(„Kita“) pagrindas, be konkrečios teisės akto nuorodos.",
        formulaLt:
            "yra bent vienas atmestas pasiūlymas (atmetimoPriezastis IS NOT NULL) IR to pasiūlymo teisinis " +
            "pagrindas (atmetimoTeisinisPagrindas) yra nenurodytas ARBA priklauso bendro pobūdžio pagrindų sąrašui",
        limitationLt:
            "Teisinio pagrindo laukas yra atskiras struktūrizuotas (išsirenkamas iš sąrašo) laukas, o ne pati " +
            "atmetimo motyvacija — dalyje atvejų, kai perkančioji organizacija pasirinko „Kita“, laisvo teksto " +
            "lauke (atmetimoPriezastis) vis tiek nurodomas konkretus VPĮ/KSPĮ straipsnis, todėl rodiklis gali " +
            "pažymėti dalį iš tiesų pagrįstų atmetimų kaip nepakankamai pagrįstus. Rodiklis taip pat nevertina, " +
            "ar nurodytas teisinis pagrindas iš tiesų atitinka atmetimo aplinkybes (STT-I14 „nenuoseklių " +
            "pagrindų“ dalis) — tik tai, ar koks nors konkretus pagrindas apskritai buvo nurodytas.",
    },
};
