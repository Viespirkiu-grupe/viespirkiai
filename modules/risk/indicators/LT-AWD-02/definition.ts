import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-AWD-02 — Lowest bid disqualified (Žemiausios kainos pasiūlymas atmestas).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtAwd02Parameters extends BaseParameters {
    // At least this many of the lot's bids must carry a usable price
    // (pasiulymoKaina) for "the lowest bid" to mean anything comparative —
    // with only one priced bid there is nothing to compare it against.
    readonly minimumPricedBids: number;
}

export const ltAwd02Definition: RiskIndicatorDefinition<LtAwd02Parameters> = {
    key: { id: "LT-AWD-02", version: 1 },
    subjectType: "lot",
    stage: "award",
    references: ["OCP-R036"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "pasiulymoKaina", "atmetimoPriezastis"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        minimumPricedBids: 2,
        source: "OCP Red Flags in Public Procurement 2024 (OCP-R036, 'Lowest bid disqualified'), " +
            "catalogue definition. Bid price (v_dalyviai_v2.pasiulymoKaina) reads both the price-ranking table " +
            "(xlsxPPApasiulymuEile.kaina) and, as a fallback, the rejected-bids table's own price column " +
            "(xlsxPPAatmestiPasiulymai.pasiulymoKaina) — see LT-AWD-02's README for why the fallback was added.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Žemiausios kainos pasiūlymas atmestas",
        descriptionLt:
            "Pirkimo dalyje mažiausią kainą pasiūlęs tiekėjas (arba visi tiekėjai, pasiūlę tą pačią mažiausią " +
            "kainą) buvo atmestas (-i), o tinkamu liko brangesnį pasiūlymą pateikęs tiekėjas.",
        formulaLt:
            "tinkamų (su nurodyta kaina) pasiūlymų skaičius ≥ taikoma riba IR mažiausios kainos pasiūlymas(-ai) " +
            "atmesti IR yra bent vienas didesnės kainos tinkamas (neatmestas) pasiūlymas",
        limitationLt:
            "Rodiklis nevertina, ar atmetimas buvo teisėtas ar nepagrįstas (tam žr. LT-AWD-03 „Nepakankamai " +
            "pagrįstas atmetimas“) — pigiausio pasiūlymo atmetimas gali turėti visiškai teisėtą pagrindą (pvz., " +
            "neatitikimas techninei specifikacijai). Atmesto pasiūlymo kaina ATN-1 ataskaitoje užfiksuojama " +
            "rečiau nei tinkamo pasiūlymo kaina, todėl rodiklis gali neaptikti dalies realių atvejų, kai kaina " +
            "apskritai nebuvo užfiksuota atmetimo metu — tai reiškia, kad rodiklio neįsijungimas savaime " +
            "nepatvirtina, jog mažiausios kainos pasiūlymas visada išliko. „pasiulymoKaina“ yra viena bendra " +
            "pasiūlymo kaina, be PVM/valiutos ar apimties normalizavimo.",
    },
};
