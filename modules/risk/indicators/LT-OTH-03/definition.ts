import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-OTH-03 — Evaluation/decision period anomalously short or long
// (Vertinimo (sprendimo priėmimo) laikotarpis nepagrįstai trumpas arba
// ilgas).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtOth03Parameters extends BaseParameters {
    // The ATN-1/PPA procedure report's own closed-vocabulary
    // "proceduruPabaiga" labels that mean a contract, preliminary
    // agreement, dynamic purchasing system, or design contest winner was
    // actually concluded — the same list LT-OTH-05 uses, and for the same
    // reason: only for a concluded lot does "sprendimoPriemimoData" mean
    // "the day the buyer decided the evaluation", rather than, e.g., a
    // pre-deadline cancellation that never reached evaluation at all.
    readonly concludedOutcomes: readonly string[];
    // Trigger when a concluded lot's period (sprendimoPriemimoData minus the
    // procurement's pasiulymuPateikimoTerminas, in days) is strictly below
    // this many days — "anomalously short".
    readonly minimumDays: number;
    // Trigger when a concluded lot's period is strictly above this many
    // days — "anomalously long".
    readonly maximumDays: number;
}

export const ltOth03Definition: RiskIndicatorDefinition<LtOth03Parameters> = {
    key: { id: "LT-OTH-03", version: 1 },
    subjectType: "procurement",
    stage: "award",
    references: ["OCP-R015", "OCP-R061", "OCP-R062", "OLAF-CA08", "OT-I05", "VPT-I10"],
    sourceRelations: ["public.v_pirkimas_v2", "public.v_pirkimo_pabaiga_v2"],
    requiredInputs: ["sprendimoPriemimoData", "pasiulymuPateikimoTerminas"],
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
        minimumDays: 3,
        maximumDays: 120,
        source:
            "OCP Red Flags in Public Procurement 2024 (OCP-R061 'decision period extremely short', OCP-R062 " +
            "'decision period extremely long'), cross-referenced against OLAF-CA08, OT-I05, VPT-I10: none of the " +
            "source booklets state an operational day count, so the bounds are the empirical 5th/95th-percentile-" +
            "adjacent cut points measured 2026-08 against the real warehouse population of concluded lots (period " +
            "= sprendimoPriemimoData - pasiulymuPateikimoTerminas, n=9,321) — see README.md.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Vertinimo (sprendimo priėmimo) laikotarpis nepagrįstai trumpas arba ilgas",
        descriptionLt:
            "Pirkimo daliai, kurioje ATN-1 (PPA) ataskaita nurodo, kad buvo sudaryta pirkimo sutartis " +
            "(preliminarioji sutartis), sukurta dinaminė pirkimų sistema arba nustatytas projekto konkurso " +
            "laimėtojas, laikotarpis nuo pasiūlymų pateikimo termino iki sprendimo priėmimo datos yra už taikomų " +
            "ribų — arba nepagrįstai trumpas, arba nepagrįstai ilgas.",
        formulaLt:
            "sprendimo priėmimo data − pasiūlymų pateikimo terminas (dienomis) < apatinė riba ARBA > viršutinė riba",
        limitationLt:
            "Rodiklis skaičiuojamas tik toms pirkimo dalims, kurios baigėsi sutarties sudarymu — kitiems " +
            "baigties variantams (nutraukta procedūra, visi pasiūlymai atmesti) sprendimo data dažnai nesusijusi " +
            "su realiu pasiūlymų vertinimu (pvz., procedūra gali būti nutraukta dar nepasibaigus pasiūlymų " +
            "pateikimo terminui), todėl tokioms dalims rodiklis duomenų nepakanka. Trumpas laikotarpis gali būti " +
            "paaiškinamas paprastu, vieno pasiūlymo vertinimu; ilgas — sudėtingu pirkimo objektu, dideliu " +
            "pasiūlymų skaičiumi arba teisėtu paaiškinimo prašymu iš tiekėjo. Ribos nustatytos empiriškai iš " +
            "realių duomenų (žr. README.md), o ne iš teisės akto nustatyto termino.",
    },
};
