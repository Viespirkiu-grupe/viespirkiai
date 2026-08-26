import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-PRI-05 — High estimated value (Aukšta numatoma pirkimo vertė).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtPri05Parameters extends BaseParameters {
    // Trigger when a procurement's own numatomaVerteEUR is strictly above
    // this bound. See definition.ts's `source` field for how the bound was
    // set — the OLAF booklet names the concept but no operational amount.
    readonly minimumValueEUR: number;
}

export const ltPri05Definition: RiskIndicatorDefinition<LtPri05Parameters> = {
    key: { id: "LT-PRI-05", version: 1 },
    subjectType: "procurement",
    stage: "planning",
    references: ["OLAF-CN06"],
    sourceRelations: ["public.v_pirkimas_v2"],
    requiredInputs: ["numatomaVerteEUR"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        minimumValueEUR: 1_400_000,
        source:
            "OLAF-supported Red Flags indicators (OLAF-CN06 'High estimated value of the contract'): the booklet " +
            "lists this only as a summary-list title (item I.7, p. 9) with no operational amount — its own " +
            "practical-recommendations section (p. 11) says benchmarks were set 'what price for a contract is " +
            "\"too high\"' through expert consultation on the Hungarian market, which does not transfer to " +
            "Lithuania. The bound is instead the empirical 95th-percentile cut point (rounded to a clean amount) " +
            "measured 2026-08 against the real warehouse population of eligible procurements carrying a value " +
            "(saltinis='cvpis', pirkimoBudas not null, numatomaVerteEUR not null; n=17,403; p95≈1,404,918 EUR) — " +
            "see README.md.",
    },
    standard: {
        name: 'OLAF-supported Red Flags indicators ("Red Flags" – a New Automatic Warning System, item I.7 "High estimated value of the contract")',
        url: "https://transparency.lt/wp-content/uploads/2018/04/OLAF_Red_Flags_Booklet.pdf",
        page: 9,
    },
    public: {
        titleLt: "Aukšta numatoma pirkimo vertė",
        descriptionLt: "Pirkimo numatoma vertė (numatomaVerteEUR) viršija taikomą ribą.",
        formulaLt: "numatomaVerteEUR > taikoma riba",
        limitationLt:
            "Numatoma vertė žinoma tik pirminio (cvpis) šaltinio pirkimams, o ir tarp jų užpildyta tik daliai " +
            "(apie 34 %, žr. domain-model.md §5.1) — likusiems pirkimams rodiklis grąžins duomenų nepakanka, o ne " +
            "„rizikos nėra“. Aukšta vertė gali būti paaiškinama teisėtu didelio masto ar ilgalaikiu pirkimu " +
            "(statybos darbai, infrastruktūra, daugiametė sutartis); rodiklis nevertina, ar vertė atitinka " +
            "pirkimo objektą, o tik lygina ją su empiriškai nustatyta riba.",
    },
};
