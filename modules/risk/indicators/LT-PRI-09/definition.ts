import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-PRI-09 — Heavily discounted bid (Smarkiai nuvertinta laimėjusio pasiūlymo kaina).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtPri09Parameters extends BaseParameters {
    // At least this many of the lot's bids must be valid (not disqualified)
    // and carry a usable price for the winner-vs-runner-up comparison to
    // mean anything — the winning bid plus at least one competitor. Same
    // reasoning as LT-COM-10/LT-COM-11/LT-COM-12/LT-COM-13's minimumPricedBids,
    // narrowed to valid bids only since OCP-R058 compares against the
    // "second-lowest valid bid", not just the second-lowest priced one.
    readonly minimumValidBids: number;
    // The relative discount ((secondLowestValidPrice - winningPrice) /
    // winningPrice) must be at least this large to count as "heavily
    // discounted" — the runner-up's price is at least this much higher than
    // the winner's, relative to the winner. Same value and reasoning as
    // LT-COM-13's minRelativeGap: this is the identical statistic, just
    // restricted to the winning bid and valid competitors.
    readonly minRelativeDiscount: number;
}

export const ltPri09Definition: RiskIndicatorDefinition<LtPri09Parameters> = {
    key: { id: "LT-PRI-09", version: 1 },
    subjectType: "bid",
    stage: "award",
    references: ["OCP-R058"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "eileNumeris", "pasiulymoKaina", "atmetimoPriezastis"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        minimumValidBids: 2,
        minRelativeDiscount: 1.0,
        source:
            "OCP Red Flags in Public Procurement 2024 (OCP-R058, 'Heavily discounted bid': 'the percentage " +
            "difference between the winning bid and the second-lowest valid bid is a high outlier'). The guide's " +
            "own methodology computes (secondLowestValidBidAmount - winningBidAmount) / winningBidAmount and flags " +
            "the winner when it exceeds a population-derived outlier fence (Q3 + 1.5·IQR); this deployment uses a " +
            "fixed 100% relative-discount threshold instead — the same value and reasoning as LT-COM-13's " +
            "minRelativeGap for the identical underlying statistic, since a per-run recomputed statistical fence " +
            "is not yet supported by the parameter model.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Smarkiai nuvertinta laimėjusio pasiūlymo kaina",
        descriptionLt:
            "Pirkimo dalyje laimėjusio (mažiausią kainą pasiūliusio ir neatmesto) tiekėjo kaina yra gerokai " +
            "mažesnė už kitą mažiausią tinkamą (neatmestą) konkuruojančio tiekėjo pasiūlymo kainą.",
        formulaLt:
            "pasiūlymas yra laimėjęs (eilės numeris = 1 IR pasiūlymas neatmestas) IR laimėjusio pasiūlymo kaina " +
            "yra mažiausia tarp visų tinkamų (neatmestų, su nurodyta kaina) pirkimo dalies pasiūlymų IR tinkamų " +
            "pasiūlymų skaičius pirkimo dalyje ≥ taikoma riba IR (kita mažiausia tinkama kaina − laimėjusio " +
            "pasiūlymo kaina) / laimėjusio pasiūlymo kaina ≥ taikoma santykinės nuolaidos riba",
        limitationLt:
            "Rodiklis remiasi ATN-1 (PPA) ataskaitos pasiūlymų eile, kurioje laimėtojas nustatomas kaip pirmas " +
            "eilėje ir neatmestas tiekėjas. Pasiūlymų eilė sudaroma pagal pirkimo vertinimo kriterijų, todėl " +
            "vertinant ekonomiškai naudingiausią pasiūlymą (ne vien kainą) laimėtojas gali būti ir ne pigiausias " +
            "— tokiu atveju nuolaidos nėra ką matuoti ir rodiklis netaikomas (pirkimo dalis pažymima " +
            "„netaikoma“). Visos duomenų aibės matavimu (2026-09) tokių pirkimo dalių yra apie 12 proc. tų, " +
            "kuriose apskritai yra su kuo palyginti. Didelis kainos skirtumas nuo kito tinkamo pasiūlymo gali " +
            "turėti teisėtų priežasčių (efektyvesnė tiekėjo veikla, siauras konkurentų ratas, apskaitos ar PVM " +
            "traktavimo skirtumai) ir savaime nėra sukčiavimo įrodymas. Dalis suveikusių atvejų taip pat gali " +
            "būti ne reali nuolaida, o vieneto ir bendros (ar kiekio padaugintos) kainos sumaišymo duomenų " +
            "įvedimo klaida — tą pačią išlygą turi ir LT-COM-13. Todėl prieš vertinant signalą verta pirmiausia " +
            "patikrinti pačios kainos tikėtinumą, o tik tada — ar tiekėjas realiai pajėgus įvykdyti sutartį už " +
            "pasiūlytą kainą.",
    },
};
