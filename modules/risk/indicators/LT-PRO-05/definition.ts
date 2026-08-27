import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-PRO-05 — Accelerated procedure without adequate grounds (Pagreitinta
// procedūra be pakankamo pagrindo).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtPro05Parameters extends BaseParameters {
    // The closed set of Subject.procurement.pirkimoBudas labels that mean an
    // accelerated ("pagreitinta procedūra") procedure was used — see
    // README.md for how this list was derived from the real distinct
    // values, matched with plain .includes(), never a free-text pattern.
    readonly acceleratedProcedures: readonly string[];
}

export const ltPro05Definition: RiskIndicatorDefinition<LtPro05Parameters> = {
    key: { id: "LT-PRO-05", version: 1 },
    subjectType: "procurement",
    stage: "tender",
    references: ["OLAF-CN22"],
    sourceRelations: ["public.v_pirkimas_v2"],
    requiredInputs: ["pirkimoBudas"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        acceleratedProcedures: [
            "Atviras konkursas (pagreitinta procedūra)",
            "Ribotas konkursas (pagreitinta procedūra) pagal VPĮ/GSPĮ",
            "Skelbiamos derybos (pagreitinta procedūra) pagal GSPĮ",
        ],
        source:
            "OLAF-supported Red Flags indicators (OLAF-CN22 'The use of accelerated procedure', item I.23, p. 9): " +
            "the accelerated variant is named directly, in parentheses, on three of the 15 distinct " +
            "Subject.procurement.pirkimoBudas labels observed 2026-08 against the real warehouse population " +
            "eligible under procurementEligibility() (saltinis='cvpis', pirkimoBudas not null; n=51,531) — see " +
            "README.md for the full label breakdown.",
    },
    standard: {
        name: 'OLAF-supported Red Flags indicators ("Red Flags" – a New Automatic Warning System, item I.23 "The use of accelerated procedure")',
        url: "https://transparency.lt/wp-content/uploads/2018/04/OLAF_Red_Flags_Booklet.pdf",
        page: 9,
    },
    public: {
        titleLt: "Pagreitinta procedūra be pakankamo pagrindo",
        descriptionLt:
            "Pirkimo būdas (pirkimoBudas) yra pagreitintos procedūros variantas — leidžiama tik pagrįstos " +
            "skubos atveju, todėl trumpesni terminai turi būti teisiškai pagrįsti.",
        formulaLt: "pirkimoBudas ∈ {pagreitintos procedūros variantai}",
        limitationLt:
            "Rodiklis pažymi pačios pagreitintos procedūros naudojimo faktą — jis nevertina, ar sutrumpinti " +
            "terminai buvo teisiškai pagrįsti (pvz., objektyvi skuba), nes jokia įtraukto šaltinio lentelė " +
            "nefiksuoja pirkimo būdo teisinio pagrindimo struktūrizuotai (žr. LT-OTH-01 paaiškinimą dėl " +
            "pirkimoBudoPagrindimo laisvo teksto). Rodiklis mato tik skelbiamas (viešai paskelbtas) procedūras — " +
            "CVP IS pirkimo pranešimai apima tik paskelbtus pirkimo būdus, todėl neskelbiamos pagreitintos " +
            "procedūros (jei tokių pasitaiko) šiuo šaltiniu nematomos ir rodiklio aprėptyje nėra.",
    },
};
