import type {BaseParameters, RiskIndicatorDefinition} from "../../types.ts";

// LT-COM-13 — Wide disparity in bid prices (Didelis atotrūkis tarp mažiausios ir kitos pasiūlymo kainos).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtCom13Parameters extends BaseParameters {
    // At least this many of the lot's bids must carry a usable price
    // (pasiulymoKaina) for a gap comparison to mean anything — same
    // reasoning as LT-COM-10/LT-COM-11/LT-COM-12's minimumPricedBids.
    readonly minimumPricedBids: number;
    // The relative gap ((secondLowest - lowest) / lowest) between the two
    // cheapest distinct-supplier priced bids must be at least this large to
    // count as "wide disparity" — the next-cheapest offer costs at least
    // this much more than the cheapest one, relative to the cheapest.
    readonly minRelativeGap: number;
}

export const ltCom13Definition: RiskIndicatorDefinition<LtCom13Parameters> = {
    key: {id: "LT-COM-13", version: 1},
    subjectType: "lot",
    stage: "award",
    references: ["OCP-R022", "OECD-BR-26"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "pasiulymoKaina"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        minimumPricedBids: 2,
        minRelativeGap: 1.0,
        source: "OCP Red Flags in Public Procurement 2024 (OCP-R022, 'Wide disparity in bid prices'), " +
            "cross-referenced against OECD-BR-26 ('Large winner-to-other-bid gap'), catalogue definition.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Didelis atotrūkis tarp mažiausios ir kitos pasiūlymo kainos",
        descriptionLt:
            "Pirkimo dalyje pigiausio pasiūlymo kaina yra gerokai mažesnė už kito pigiausio pasiūlymo kainą — " +
            "tiekėjų kainos smarkiai išsiskiria.",
        formulaLt:
            "tinkamų (su nurodyta kaina) pasiūlymų skaičius ≥ taikoma riba IR santykinis skirtumas tarp dviejų " +
            "pigiausių skirtingų tiekėjų kainų ((antra pagal dydį mažiausia − mažiausia) / mažiausia) yra ne " +
            "mažesnis už taikomą ribą",
        limitationLt:
            "Rodiklis vertina tik kainų atotrūkį, o ne jo priežastį — didelis skirtumas gali atsirasti dėl " +
            "teisėtų priežasčių (skirtingas tiekėjų dydis, rizikos vertinimas, kokybės lygis ar rinkos siaurumas), " +
            "o ne dėl susitarimo. Kai pigiausio pasiūlymo kaina labai maža, didelis santykinis skirtumas gali " +
            "atspindėti ne realų konkurencijos iškraipymą, o duomenų įvedimo klaidą (pvz., sumaišytą vieneto ir " +
            "bendrą kainą) — tokiais atvejais verta pirmiausia patikrinti pačios kainos tikėtinumą. Rodiklis " +
            "nevertina kainos sudėties (PVM, valiuta, apimtis) ir neatskiria atsitiktinio nutolimo nuo suderinto " +
            "(pvz., dengiamųjų pasiūlymų) elgesio.",
    },
};
