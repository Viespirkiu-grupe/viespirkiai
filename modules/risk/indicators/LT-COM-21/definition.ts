import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-COM-21 — Non-genuine, incomplete, or incapable bid (Netikėtai neišsamus
// ar nepajėgaus tiekėjo pasiūlymas).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtCom21Parameters extends BaseParameters {
    // ATN-1/PPA procedure report's structured legal-basis citations
    // (xlsxPPAatmestiPasiulymai.atmetimoTeisinisPagrindasId, exposed as
    // public.v_dalyviai_v2."atmetimoTeisinisPagrindas") that mean the bid was
    // disqualified as non-conforming, unresponsive to a clarification
    // request, or the bidder itself unqualified — as opposed to price-based
    // or supplier-exclusion grounds. A list, not one literal: the source
    // dictionary's VPĮ/KSPĮ citations can gain another point without a new
    // indicator version.
    readonly nonGenuineIncompleteIncapableLegalBases: readonly string[];
}

export const ltCom21Definition: RiskIndicatorDefinition<LtCom21Parameters> = {
    key: { id: "LT-COM-21", version: 1 },
    subjectType: "bid",
    stage: "tender",
    references: ["OECD-BR-13", "OECD-BR-16", "OECD-BR-32", "OECD-BR-38", "OECD-BR-46"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "atmetimoPriezastis", "atmetimoTeisinisPagrindas"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        nonGenuineIncompleteIncapableLegalBases: [
            "VPĮ 45 str. 1 d. 1 p.",
            "VPĮ 45 str. 1 d. 3 p.",
            "VPĮ 45 str. 1 d. 4 p.",
        ],
        source:
            "OECD Guidelines for Fighting Bid Rigging in Public Procurement, 2025 Update (OECD-BR-13/16/46, " +
            "'unexpectedly incomplete or erroneous bid', 'lacks expected detail or otherwise appears non-genuine', " +
            "'submitted by a company incapable of performing the contract'), matched against the ATN-1/PPA " +
            "procedure report's own structured legal-basis dictionary (xlsxPPAatmetimoTeisiniaiPagrindai) for the " +
            "VPĮ 45 straipsnio 1 dalies points meaning the bid itself did not conform to the tender documents (1 " +
            "p.), the bidder did not meet qualification requirements (3 p.), or the bidder failed to clarify, " +
            "supplement, or explain requested documents (4 p.) — as distinct from a price-based rejection (5 p.) " +
            "or a supplier-exclusion ground (2 p.).",
    },
    standard: {
        name: "OECD Guidelines for Fighting Bid Rigging in Public Procurement, 2025 Update",
        url: "https://www.oecd.org/en/publications/oecd-guidelines-for-fighting-bid-rigging-in-public-procurement-2025-update_cbe05a56-en.html",
    },
    public: {
        titleLt: "Netikėtai neišsamus ar nepajėgaus tiekėjo pasiūlymas",
        descriptionLt:
            "Tiekėjo pasiūlymas pirkimo dalyje atmestas, o ATN-1 (PPA) ataskaitoje nurodytas struktūrizuotas " +
            "atmetimo teisinis pagrindas reiškia, kad pasiūlymas neatitiko pirkimo dokumentų reikalavimų, tiekėjas " +
            "neatitiko kvalifikacijos reikalavimų arba nepatikslino, nepapildė ar nepaaiškino pasiūlymo perkančiajai " +
            "organizacijai paprašius.",
        formulaLt:
            "pasiūlymo atmetimo priežastis IS NOT NULL AND pasiūlymo atmetimo teisinis pagrindas ∈ " +
            "{VPĮ 45 str. 1 d. 1 p., 3 p., 4 p.}",
        limitationLt:
            "Rodiklis remiasi buveinės pačios užpildytu struktūrizuotu (išskleidžiamojo sąrašo) teisinio pagrindo " +
            "lauku — jei perkančioji organizacija atmetimą įformino be konkretaus teisinio pagrindo arba nurodė jį " +
            "netiksliai, atvejis nebus aptiktas (žr. LT-AWD-03 apie prastai pagrįstą atmetimą). Rodiklis nevertina " +
            "nei rinkos žvalgybos elgsenos (pvz., ar tik vienas dalyvis prieš pasiūlymo pateikimą teiravosi kainų " +
            "iš didmenininkų), nei tiesioginių dalyvių pareiškimų, rodančių dangstomąjį pasiūlymą (angl. cover " +
            "bidding) — tokiems požymiams reikalingi duomenys nėra fiksuojami ATN-1 ataskaitoje. Pasiūlymo " +
            "atmetimas dėl neišsamumo ar nepakankamos kvalifikacijos taip pat gali turėti teisėtą priežastį, todėl " +
            "rodiklis savaime nėra sukčiavimo ar dangstomojo pasiūlymo įrodymas.",
    },
};
