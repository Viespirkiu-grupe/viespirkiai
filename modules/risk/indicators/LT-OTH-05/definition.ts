import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-OTH-05 — Procedure unsuccessful or award not contracted (Pirkimo
// procedūra pasibaigė nesėkmingai arba be sutarties sudarymo).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtOth05Parameters extends BaseParameters {
    // The ATN-1/PPA procedure report's own closed-vocabulary
    // "proceduruPabaiga" labels (xlsxPPAproceduruPabaiga.proceduruPabaiga,
    // exposed as public.v_pirkimo_pabaiga_v2."proceduruPabaiga") that mean a
    // contract, preliminary agreement, dynamic purchasing system, or design
    // contest winner was actually concluded. A list, not one literal: the
    // report form's own dropdown carries several near-duplicate phrasings
    // for the same outcome (capitalization and a "pirkimo"/"pirkimų"
    // wording difference), and a future report revision can add another
    // without a new indicator version.
    readonly concludedOutcomes: readonly string[];
}

export const ltOth05Definition: RiskIndicatorDefinition<LtOth05Parameters> = {
    key: { id: "LT-OTH-05", version: 1 },
    subjectType: "procurement",
    stage: "award",
    references: ["OLAF-CA05", "OLAF-CA06", "OLAF-CA07", "VPT-I11"],
    sourceRelations: ["public.v_pirkimo_pabaiga_v2"],
    requiredInputs: ["proceduruPabaiga"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        concludedOutcomes: [
            "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
            "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimo sistemą arba nustačius projekto konkurso laimėtoją",
            "sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
            "Sudarius pirkimo sutartį (preliminariąją sutartį) arba nustačius projekto konkurso laimėtoją",
            "Sudarius pirkimo sutartį",
        ],
        source:
            "OLAF-supported \"Red Flags\" booklet's contract-award-notice list, items II.5 (\"Unsuccessful procedure " +
            "for risky reasons\"), II.6 (\"Unsuccessful procedure without statement of reason\") and II.7 " +
            "(\"Successful procedure without contracting\"), merged into one closed-vocabulary check against the " +
            "ATN-1/PPA report's own \"Pirkimo procedūros pabaiga\" field: every label observed in the real data that " +
            "is not one of the five \"contract concluded\" phrasings above (quantified 2026-08 — see README.md) is " +
            "an unsuccessful-procedure or award-not-contracted outcome under this merged definition.",
    },
    standard: {
        name: 'Towards More Integrity: "Red Flags" – a New Automatic Warning System',
        url: "https://transparency.lt/wp-content/uploads/2018/04/OLAF_Red_Flags_Booklet.pdf",
        page: 9,
    },
    public: {
        titleLt: "Pirkimo procedūra pasibaigė nesėkmingai arba be sutarties sudarymo",
        descriptionLt:
            "Visose pirkimo dalyse ATN-1 (PPA) ataskaitoje nurodyta pirkimo procedūros pabaigos priežastis " +
            "nė vienoje dalyje nereiškia, kad buvo sudaryta pirkimo sutartis (preliminarioji sutartis), sukurta " +
            "dinaminė pirkimų sistema arba nustatytas projekto konkurso laimėtojas.",
        formulaLt:
            "visoms pirkimo dalims: procedūros pabaigos priežastis ∉ {sutarties sudarymo priežastys}",
        limitationLt:
            "Rodiklis remiasi ATN-1 (PPA) ataskaitos pačios nurodyta procedūros pabaigos priežastimi — jis " +
            "neskiria priežasčių, kurios yra rizikingos (pvz., visi pasiūlymai atmesti be aiškaus pagrindo), nuo " +
            "teisėtų ir dažnų priežasčių (pvz., niekas nepateikė pasiūlymo siaurai specializuotam pirkimui, arba " +
            "perkančioji organizacija pagrįstai nutraukė procedūrą dėl objektyvių aplinkybių). Daugiadalis " +
            "pirkimas, kuriame nesėkminga tik viena maža dalis, o likusios sėkmingai sudarytos, taip pat " +
            "nesuveiks — rodiklis vertina visą pirkimą, o ne atskirą dalį. ATN-1 ataskaitos teikiamos ne visiems " +
            "pirkimo būdams (žr. README.md), todėl žemos vertės apklausos dažnai lieka be duomenų.",
    },
};
