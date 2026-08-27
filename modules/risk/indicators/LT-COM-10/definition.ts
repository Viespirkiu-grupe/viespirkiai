import type {BaseParameters, RiskIndicatorDefinition} from "../../types.ts";

// LT-COM-10 — Identical bid prices (Vienodos pasiūlymų kainos).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtCom10Parameters extends BaseParameters {
    // At least this many of the lot's bids must carry a usable price
    // (pasiulymoKaina) for "identical" to mean anything comparative — with
    // only one priced bid there is nothing for it to match.
    readonly minimumPricedBids: number;
}

export const ltCom10Definition: RiskIndicatorDefinition<LtCom10Parameters> = {
    key: {id: "LT-COM-10", version: 1},
    subjectType: "lot",
    stage: "award",
    references: ["OCP-R028", "OECD-BR-24"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "pasiulymoKaina"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        minimumPricedBids: 2,
        source: "OCP Red Flags in Public Procurement 2024 (OCP-R028, 'Identical bid prices'), catalogue definition.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Vienodos pasiūlymų kainos",
        descriptionLt:
            "Pirkimo dalyje bent du skirtingi tiekėjai pasiūlė lygiai tą pačią kainą.",
        formulaLt:
            "tinkamų (su nurodyta kaina) pasiūlymų skaičius ≥ taikoma riba IR bent du skirtingi tiekėjai " +
            "pasiūlė identišką kainą",
        limitationLt:
            "Rodiklis vertina tik tai, ar kainos sutampa, o ne kodėl — sutapimas gali atsirasti atsitiktinai, " +
            "ypač kai kaina yra apvalus arba nedidelis skaičius (pvz., simbolinė 1 EUR ar 10 EUR kaina), arba kai " +
            "pirkimo dalies kaina iš esmės nustatoma paties pirkėjo (pvz., fiksuota sąmata). Rodiklis nevertina " +
            "kainos sudėties (PVM, valiuta, apimtis) ir neatskiria atsitiktinio sutapimo nuo suderinto elgesio.",
    },
};
