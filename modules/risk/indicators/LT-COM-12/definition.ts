import type {BaseParameters, RiskIndicatorDefinition} from "../../types.ts";

// LT-COM-12 — Suspiciously close bid prices (Įtartinai artimos pasiūlymų kainos).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtCom12Parameters extends BaseParameters {
    // At least this many of the lot's bids must carry a usable price
    // (pasiulymoKaina) for a relative-gap comparison to mean anything — same
    // reasoning as LT-COM-10/LT-COM-11's minimumPricedBids.
    readonly minimumPricedBids: number;
    // A pair of distinct suppliers' prices whose relative gap ((higher -
    // lower) / lower) is at or below this fraction counts as "suspiciously
    // close" — near enough that independent costing making that small a
    // difference by chance is implausible, without being an exact match
    // (LT-COM-10's own, stronger concept, which this indicator excludes).
    readonly maxRelativeDifference: number;
}

export const ltCom12Definition: RiskIndicatorDefinition<LtCom12Parameters> = {
    key: {id: "LT-COM-12", version: 1},
    subjectType: "lot",
    stage: "award",
    references: ["OCP-R024", "OECD-BR-26"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "pasiulymoKaina"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        minimumPricedBids: 2,
        maxRelativeDifference: 0.01,
        source: "OCP Red Flags in Public Procurement 2024 (OCP-R024, 'Bid price close to winning bid'), catalogue definition.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Įtartinai artimos pasiūlymų kainos",
        descriptionLt:
            "Pirkimo dalyje bent dviejų skirtingų tiekėjų pasiūlytos kainos skiriasi labai nedaug, bet nėra " +
            "identiškos.",
        formulaLt:
            "tinkamų (su nurodyta kaina) pasiūlymų skaičius ≥ taikoma riba IR yra pora tiekėjų, kurių kainų " +
            "santykinis skirtumas ((didesnė − mažesnė) / mažesnė) yra didesnis už nulį, bet neviršija taikomos ribos",
        limitationLt:
            "Rodiklis vertina tik kainų artumą, o ne kodėl jos artimos — sutapimas gali atsirasti atsitiktinai, " +
            "ypač kai kainos yra nedidelės arba pirkimo dalies kaina iš esmės nustatoma paties pirkėjo (pvz., " +
            "fiksuota sąmata). Rodiklis nevertina kainos sudėties (PVM, valiuta, apimtis) ir neatskiria " +
            "atsitiktinio sutapimo nuo suderinto elgesio.",
    },
};
