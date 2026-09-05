import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-TRA-08 — Procurement challenged in court (Pareikštas ieškinys teismui).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export type LtTra08Parameters = BaseParameters;

export const ltTra08Definition: RiskIndicatorDefinition<LtTra08Parameters> = {
    key: { id: "LT-TRA-08", version: 1 },
    subjectType: "procurement",
    stage: "award",
    references: ["VPT-I14"],
    sourceRelations: ["public.v_pirkimo_pabaiga_v2"],
    requiredInputs: ["ieskinysTeismui"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        source:
            "VPT public-procurement efficiency monitoring indicator VPT-I14 (\"Share of procurements challenged " +
            "in court\") carries no operational formula of its own, so the formula is built directly from the " +
            "ATN-1/PPA report's own \"ieskinysTeismui\" field — the sibling field to \"pretenzijaPateikta\" " +
            "(LT-TRA-07) on the same report, already read via public.v_pirkimo_pabaiga_v2.",
    },
    standard: {
        name: "VPT public-procurement efficiency monitoring indicators",
        url: "https://vpt.lrv.lt/lt/statistika-ir-analize/viesuju-pirkimu-efektyvumo-stebesenos-rodikliai/",
    },
    public: {
        titleLt: "Pareikštas ieškinys teismui",
        descriptionLt:
            "ATN-1 (PPA) ataskaitoje nurodyta, kad pirkimo procedūros metu tiekėjas pareiškė ieškinį teismui dėl " +
            "perkančiosios organizacijos sprendimo (bent viena ataskaitos redakcija, pateikta pagal šį " +
            "pirkimoNumeris, žymi ieskinysTeismui = TAIP).",
        formulaLt: "ieskinysTeismui = TAIP",
        limitationLt:
            "Rodiklis remiasi tik ATN-1 (PPA) ataskaitos savarankiškai nurodytu ieškinio teismui pareiškimo " +
            "faktu — ataskaita teikiama ne visiems pirkimo būdams, todėl žemos vertės apklausos dažnai lieka be " +
            "duomenų (žr. README.md). Ieškinio pareiškimas savaime nereiškia, kad perkančiosios organizacijos " +
            "sprendimas buvo neteisėtas ar kad ieškinys buvo patenkintas — tai tik signalas, kad pirkimas " +
            "sukėlė teisminį ginčą ir vertas peržiūros.",
    },
};
