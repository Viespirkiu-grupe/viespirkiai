import type {BaseParameters, RiskIndicatorDefinition} from "../../types.ts";

// LT-COM-11 — Fixed-multiple bid prices (Kartotinės pasiūlymų kainos).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtCom11Parameters extends BaseParameters {
    // At least this many of the lot's bids must carry a usable price
    // (pasiulymoKaina) for a ratio comparison to mean anything — same
    // reasoning as LT-COM-10's minimumPricedBids.
    readonly minimumPricedBids: number;
    // Only integer multiples from 2 up to this value count as "fixed" — a
    // simple round factor a cover bidder could apply without doing real
    // costing (double, triple, ...). A higher multiple is not a materially
    // different concept but grows less plausible as a deliberate shortcut
    // and rarer in the data, so the search is bounded rather than open-ended.
    readonly maxMultiple: number;
    // How close (relative to the multiple) a pair's actual ratio must be to
    // count as "the same" multiple, absorbing floating-point/rounding noise
    // from cents-level source prices without accepting a merely close ratio.
    readonly relativeTolerance: number;
}

export const ltCom11Definition: RiskIndicatorDefinition<LtCom11Parameters> = {
    key: {id: "LT-COM-11", version: 1},
    subjectType: "lot",
    stage: "award",
    references: ["OCP-R023", "OECD-BR-25"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "pasiulymoKaina"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        minimumPricedBids: 2,
        maxMultiple: 5,
        relativeTolerance: 0.005,
        source: "OCP Red Flags in Public Procurement 2024 (OCP-R023, 'Fixed-multiple bid prices'), catalogue definition.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Kartotinės pasiūlymų kainos",
        descriptionLt:
            "Pirkimo dalyje bent dviejų skirtingų tiekėjų pasiūlytos kainos santykis yra beveik tiksliai " +
            "sveikasis skaičius (pvz., viena kaina lygiai dvigubai didesnė už kitą).",
        formulaLt:
            "tinkamų (su nurodyta kaina) pasiūlymų skaičius ≥ taikoma riba IR yra pora tiekėjų, kurių kainų " +
            "santykis (didesnė/mažesnė) patenka į [2; taikoma riba] intervalą ir nuo artimiausio sveikojo skaičiaus " +
            "nutolsta ne daugiau kaip taikomas leistinas nuokrypis",
        limitationLt:
            "Rodiklis vertina tik kainų santykį, o ne kodėl jis toks — sutapimas gali atsirasti atsitiktinai, " +
            "ypač kai kainos yra nedidelės arba apvalios (pvz., 1 EUR ir 2 EUR). Rodiklis nevertina kainos " +
            "sudėties (PVM, valiuta, apimtis) ir neatskiria atsitiktinio sutapimo nuo suderinto elgesio.",
    },
};
