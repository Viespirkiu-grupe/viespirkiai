import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-OTH-04 — Award-to-signature period unusually long (Laikotarpis nuo
// sprendimo dėl pirkimo laimėtojo iki sutarties sudarymo nepagrįstai ilgas).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtOth04Parameters extends BaseParameters {
    // The ATN-1/PPA procedure report's own closed-vocabulary
    // "proceduruPabaiga" labels that mean a contract, preliminary agreement,
    // dynamic purchasing system, or design contest winner was actually
    // concluded — the same list LT-OTH-03/LT-OTH-05 use, and for the same
    // reason: only for a concluded lot does "sprendimoPriemimoData" mean
    // "the day the buyer decided to award", the date this indicator's period
    // starts from.
    readonly concludedOutcomes: readonly string[];
    // Trigger when a concluded lot's period (the earliest of the
    // procurement's own contract "sudarymoData" values on or after that
    // lot's sprendimoPriemimoData, minus sprendimoPriemimoData, in days) is
    // strictly above this many days — "unusually long". One-directional,
    // unlike LT-OTH-03: a contract cannot genuinely be signed before the
    // award was decided, so there is no "unusually short" side to this
    // indicator (see decision.ts's pairing rule).
    readonly maximumDays: number;
}

export const ltOth04Definition: RiskIndicatorDefinition<LtOth04Parameters> = {
    key: { id: "LT-OTH-04", version: 1 },
    subjectType: "procurement",
    stage: "contract",
    references: ["OCP-R060"],
    sourceRelations: ["public.v_pirkimo_pabaiga_v2", "public.v_pirkimo_sutartys_v2"],
    requiredInputs: ["sprendimoPriemimoData", "sudarymoData"],
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
        maximumDays: 36,
        source:
            "OCP Red Flags in Public Procurement 2024 (OCP-R060 'Long time between award date and contract " +
            "signature'): the booklet states no operational day count, so the bound is the empirical 95th-" +
            "percentile cut point measured 2026-08 against the real warehouse population of concluded lots " +
            "plausibly paired with a resulting contract (period = nearest contract sudarymoData on or after " +
            "sprendimoPriemimoData, minus sprendimoPriemimoData; n=7,688) — see README.md.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Laikotarpis nuo sprendimo dėl pirkimo laimėtojo iki sutarties sudarymo nepagrįstai ilgas",
        descriptionLt:
            "Pirkimo daliai, kurioje ATN-1 (PPA) ataskaita nurodo, kad buvo sudaryta pirkimo sutartis " +
            "(preliminarioji sutartis), sukurta dinaminė pirkimų sistema arba nustatytas projekto konkurso " +
            "laimėtojas, laikotarpis nuo sprendimo priėmimo datos iki artimiausios šio pirkimo sutarties " +
            "sudarymo datos (ne anksčiau už sprendimo datą) viršija taikomą ribą.",
        formulaLt:
            "artimiausia sutarties sudarymo data (≥ sprendimo priėmimo data) − sprendimo priėmimo data " +
            "(dienomis) > riba",
        limitationLt:
            "Sutartis su pirkimu susiejama pagal pirkimo numerį — laisvo teksto lauką, kuris pagal " +
            "domain-model.md realiai atpažįstamas tik nedidelei daliai jam privalomų sutarčių (apie 6,1 %), " +
            "todėl didžiajai daliai pirkimų šis rodiklis grąžins duomenų nepakanka, o ne 'rizikos nėra'. " +
            "Sutarčių įrašai nežymi konkrečios pirkimo dalies, todėl esant kelioms to paties pirkimo dalims ar " +
            "sutartims rodiklis susieja sprendimo datą su artimiausia po jos sudaryta pirkimo sutartimi, o ne " +
            "patikrintu, konkrečiai daliai priklausančiu susiejimu. Rodiklis skaičiuojamas tik toms pirkimo " +
            "dalims, kurios baigėsi sutarties sudarymu — kitiems baigties variantams sprendimo data dažnai " +
            "nesusijusi su realiu vertinimu. Ilgas laikotarpis gali būti paaiškinamas teisėtu ginču dėl " +
            "pirkimo rezultatų, sutarties derybų sudėtingumu ar tiekėjo vėlavimu pateikti reikiamus " +
            "dokumentus, o ne piktnaudžiavimu. Riba nustatyta empiriškai iš realių duomenų (žr. README.md), " +
            "o ne iš teisės akto nustatyto termino.",
    },
};
