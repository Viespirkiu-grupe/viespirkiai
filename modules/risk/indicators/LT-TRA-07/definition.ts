import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-TRA-07 — Complaint received (Gauta pretenzija).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export type LtTra07Parameters = BaseParameters;

export const ltTra07Definition: RiskIndicatorDefinition<LtTra07Parameters> = {
    key: { id: "LT-TRA-07", version: 1 },
    subjectType: "procurement",
    stage: "award",
    references: ["OCP-R020", "VPT-I13", "OECD-GOV-11"],
    sourceRelations: ["public.v_pirkimo_pabaiga_v2"],
    requiredInputs: ["pretenzijaPateikta"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        source:
            "OCP Red Flags in Public Procurement 2024 (OCP-R020 \"Tender has a complaint\"), matching VPT-I13 " +
            "(\"Share of procurements receiving supplier complaints\") and OECD-GOV-11 (\"Accountability\" — " +
            "complaint mechanisms): tested against the ATN-1/PPA report's own \"pretenzijaPateikta\" field, the " +
            "same self-reported source LT-TRA-06/LT-PRI-06 already read via public.v_pirkimo_pabaiga_v2.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Gauta pretenzija",
        descriptionLt:
            "ATN-1 (PPA) ataskaitoje nurodyta, kad pirkimo procedūros metu tiekėjas pateikė pretenziją dėl " +
            "perkančiosios organizacijos sprendimo (bent viena ataskaitos redakcija, pateikta pagal šį " +
            "pirkimoNumeris, žymi pretenzijaPateikta = TAIP).",
        formulaLt: "pretenzijaPateikta = TAIP",
        limitationLt:
            "Rodiklis remiasi tik ATN-1 (PPA) ataskaitos savarankiškai nurodytu pretenzijos pateikimo faktu — " +
            "ataskaita teikiama ne visiems pirkimo būdams, todėl žemos vertės apklausos dažnai lieka be duomenų " +
            "(žr. README.md). Pretenzijos pateikimas savaime nereiškia, kad perkančiosios organizacijos sprendimas " +
            "buvo neteisėtas ar kad pretenzija buvo patenkinta — tai tik signalas, kad pirkimas sukėlė tiekėjo " +
            "ginčą ir vertas peržiūros.",
    },
};
