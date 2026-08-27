import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-TRA-09 — Procurement not conducted electronically (Pirkimas vykdytas ne
// elektroniniu būdu).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export type LtTra09Parameters = BaseParameters;

export const ltTra09Definition: RiskIndicatorDefinition<LtTra09Parameters> = {
    key: { id: "LT-TRA-09", version: 1 },
    subjectType: "procurement",
    stage: "award",
    references: ["VPT-I06", "OECD-GOV-07"],
    sourceRelations: ["public.v_pirkimo_pabaiga_v2"],
    requiredInputs: ["elektroninisPirkimas"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        source:
            "VPT public-procurement efficiency monitoring indicator VPT-I06 (\"Share of electronic procurements\") " +
            "carries no operational formula of its own, broadened by the OECD procurement integrity framework's " +
            "e-procurement principle (OECD-GOV-07 — \"Use integrated, secure digital procurement throughout the " +
            "cycle\"), so the formula is built directly from the ATN-1/PPA report's own \"elektroninisPirkimas\" " +
            "field — the same self-reported, closed-vocabulary source LT-TRA-06/LT-TRA-07/LT-TRA-08/LT-PRI-06 " +
            "already read.",
    },
    standard: {
        name: "VPT public-procurement efficiency monitoring indicators",
        url: "https://vpt.lrv.lt/lt/statistika-ir-analize/viesuju-pirkimu-efektyvumo-stebesenos-rodikliai/",
    },
    public: {
        titleLt: "Pirkimas vykdytas ne elektroniniu būdu",
        descriptionLt:
            "ATN-1 (PPA) ataskaitoje nurodyta, kad pirkimo procedūra nebuvo vykdoma elektroninėmis priemonėmis " +
            "(bent viena ataskaitos redakcija, pateikta pagal šį pirkimoNumeris, žymi elektroninisPirkimas = NE).",
        formulaLt: "elektroninisPirkimas = NE",
        limitationLt:
            "Rodiklis remiasi tik ATN-1 (PPA) ataskaitos savarankiškai nurodytu faktu — ataskaita teikiama ne " +
            "visiems pirkimo būdams, todėl žemos vertės apklausos dažnai lieka be duomenų (žr. README.md). Nuo " +
            "~2011 m. CVP IS naudojimas Lietuvoje yra iš esmės privalomas, todėl teigiamas pažymėjimas dažniausiai " +
            "reiškia teisėtai leidžiamą išimtį (pvz., įslaptintą pirkimą), o ne pačią rizikos priežastį — tai " +
            "signalas peržiūrai, ne pažeidimo įrodymas.",
    },
};
