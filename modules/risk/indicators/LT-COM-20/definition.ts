import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-COM-20 — Unexpected or frequent bid withdrawal (Netikėtas pasiūlymo atsiėmimas).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtCom20Parameters extends BaseParameters {
    // Structured ATN-1 rejection-status labels (xlsxPPAatmestuPasiulymuStatusai.pavadinimas,
    // exposed as public.v_dalyviai_v2."atmetimoStatusas") that mean the bidder withdrew
    // their own bid, as opposed to the buyer rejecting it for cause. A list, not one
    // literal: the source dictionary can add another such label without a new
    // indicator version.
    readonly withdrawalStatuses: readonly string[];
}

export const ltCom20Definition: RiskIndicatorDefinition<LtCom20Parameters> = {
    key: { id: "LT-COM-20", version: 1 },
    subjectType: "bid",
    stage: "tender",
    references: ["OECD-BR-04"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "eileNumeris", "atmetimoStatusas"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        withdrawalStatuses: ["Dalyvis (kandidatas) pasiūlymus (galutinius pasiūlymus) atsiėmė iki pasiūlymų eilės sudarymo"],
        source:
            "OECD Guidelines for Fighting Bid Rigging in Public Procurement, 2025 Update (OECD-BR-04, 'Suppliers " +
            "unexpectedly or frequently withdraw submitted bids'), matched against the ATN-1/PPA procedure report's " +
            "own structured rejection-status dictionary (xlsxPPAatmestuPasiulymuStatusai) rather than free-text " +
            "rejection reasons, which record a self-withdrawal only inconsistently.",
    },
    standard: {
        name: "OECD Guidelines for Fighting Bid Rigging in Public Procurement, 2025 Update",
        url: "https://www.oecd.org/en/publications/oecd-guidelines-for-fighting-bid-rigging-in-public-procurement-2025-update_cbe05a56-en.html",
    },
    public: {
        titleLt: "Netikėtas pasiūlymo atsiėmimas",
        descriptionLt:
            "Tiekėjo pasiūlymas pirkimo dalyje ATN-1 (PPA) ataskaitoje pažymėtas struktūrizuotu statusu, " +
            "reiškiančiu, kad dalyvis pats atsiėmė savo pasiūlymą, o ne kad jį atmetė perkančioji organizacija.",
        formulaLt: "pasiūlymo atmetimo statusas ∈ {pasiūlymo atsiėmimo statusai}",
        limitationLt:
            "Rodiklis vertina kiekvieną atsiėmimą atskirai ir nevertina, ar tas pats tiekėjas atsiima pasiūlymus " +
            "dažnai skirtinguose pirkimuose (tam reikėtų tiekėjo lygmens rodiklio). Duomenų šaltinis patikimai " +
            "fiksuoja tik atsiėmimą iki pasiūlymų eilės sudarymo — atsiėmimas po eilės sudarymo (rizikingesnis " +
            "atvejis) šiuo metu neturi atskiro struktūrizuoto statuso ir nėra aptinkamas. Pasiūlymo atsiėmimas taip " +
            "pat gali turėti teisėtą priežastį (pvz., tiekimo sutrikimas), todėl rodiklis nėra sukčiavimo įrodymas.",
    },
};
