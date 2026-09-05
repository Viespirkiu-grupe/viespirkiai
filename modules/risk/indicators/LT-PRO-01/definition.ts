import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-PRO-01 — Unjustified non-competitive procedure (Nepagrįstai naudota
// nekonkurencinė (derybų) procedūra).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtPro01Parameters extends BaseParameters {
    // The closed set of Subject.procurement.pirkimoBudas labels that mean a
    // negotiated (non-open, non-restricted) procedure was used — see
    // README.md for how this list was derived from the real distinct
    // values, matched with plain .includes(), never a free-text pattern.
    readonly nonCompetitiveProcedures: readonly string[];
}

export const ltPro01Definition: RiskIndicatorDefinition<LtPro01Parameters> = {
    key: { id: "LT-PRO-01", version: 1 },
    subjectType: "procurement",
    stage: "tender",
    references: ["OCP-R010", "OLAF-CN23", "OT-I03", "STT-I08", "VPT-I15"],
    sourceRelations: ["public.v_pirkimas_v2"],
    requiredInputs: ["pirkimoBudas"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        nonCompetitiveProcedures: [
            "Skelbiamos derybos pagal PĮ",
            "Skelbiamos derybos pagal VPĮ",
            "Skelbiamos derybos pagal GSPĮ",
            "Skelbiamos derybos (pagreitinta procedūra) pagal GSPĮ",
            "Skelbiama apklausa su derybomis",
            "Derybos pagal KĮ",
        ],
        source:
            "STT corruption-risk analyses (STT-I08, 'unjustified non-competitive or negotiated procedure') frame " +
            "the non-competitive concept as the negotiated procedure itself, so the list is the closed set of " +
            "Subject.procurement.pirkimoBudas labels (the CVP IS notice's own procedure-type field) that name a " +
            "negotiated procedure under any applicable law (PĮ/VPĮ/GSPĮ/KĮ) or a low-value survey conducted with " +
            "negotiations, out of the 15 distinct labels observed 2026-08 against the real warehouse population " +
            "eligible under procurementEligibility() (saltinis='cvpis', pirkimoBudas not null; n=51,531) — see " +
            "README.md for the full label breakdown and why 'Atviras konkursas', 'Ribotas konkursas', 'Dinaminė " +
            "pirkimo sistema' and 'Konkurencinis dialogas' are excluded as competitive-by-design.",
    },
    standard: {
        name: "STT korupcijos rizikos analizės (STT-I08 — nepagrįstas nekonkurencinės ar derybų procedūros naudojimas)",
        url: "https://www.stt.lt/korupcijos-prevencija/korupcijos-rizikos-analizes/7470",
    },
    public: {
        titleLt: "Nepagrįstai naudota nekonkurencinė (derybų) procedūra",
        descriptionLt:
            "Pirkimo būdas (pirkimoBudas) yra viena iš derybų procedūrų — leidžiama tik įstatyme nustatytais " +
            "atvejais vietoj atviro ar riboto konkurso, todėl jos pasirinkimas turi būti teisiškai pagrįstas.",
        formulaLt: "pirkimoBudas ∈ {derybų procedūrų sąrašas}",
        limitationLt:
            "Rodiklis pažymi pačios derybų procedūros naudojimo faktą — jis nevertina, ar pasirinkimas buvo " +
            "teisiškai pagrįstas, nes jokia įtraukto šaltinio lentelė nefiksuoja pirkimo būdo teisinio pagrindimo " +
            "struktūrizuotai (žr. LT-OTH-01 paaiškinimą dėl pirkimoBudoPagrindimo laisvo teksto). Derybų " +
            "procedūra gali būti visiškai teisėta (pvz., vienintelis galimas tiekėjas, ypatinga skuba, ankstesnio " +
            "konkurso nesėkmė). Rodiklis mato tik skelbiamas (viešai paskelbtas) derybas — CVP IS pirkimo " +
            "pranešimai apima tik paskelbtus pirkimo būdus, todėl labiausiai nekonkurencinės, neskelbiamos " +
            "derybos (pvz., mažos vertės pirkimai be skelbimo) šiuo šaltiniu nematomos ir rodiklio aprėptyje nėra.",
    },
};
