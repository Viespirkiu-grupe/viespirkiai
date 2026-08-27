import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-PRI-06 — High estimated framework value (Aukšta numatoma preliminariosios
// sutarties vertė).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtPri06Parameters extends BaseParameters {
    // Trigger when a framework-agreement procurement's own numatomaVerteEUR
    // is strictly above this bound. See definition.ts's `source` field for
    // how the bound was set — the OLAF booklet names the concept but no
    // operational amount.
    readonly minimumValueEUR: number;
}

export const ltPri06Definition: RiskIndicatorDefinition<LtPri06Parameters> = {
    key: { id: "LT-PRI-06", version: 1 },
    subjectType: "procurement",
    stage: "planning",
    references: ["OLAF-CN04"],
    sourceRelations: ["public.v_pirkimas_v2", "public.v_pirkimo_pabaiga_v2"],
    requiredInputs: ["preliminariSutartis", "numatomaVerteEUR"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        minimumValueEUR: 5_000_000,
        source:
            "OLAF-supported Red Flags indicators (OLAF-CN04 'High estimated framework-agreement value'): the " +
            "booklet lists this only as a summary-list title (item I.5, p. 9) with no operational amount — the " +
            "same 'expert consultation on the Hungarian market' caveat LT-PRI-05's source note explains applies " +
            "here too. The bound is instead the empirical ~95th-percentile cut point (rounded to a clean amount) " +
            "measured 2026-08 against the real warehouse population of procurements the ATN-1/PPA report itself " +
            "flags as establishing a framework agreement and that carry a value " +
            "(xlsxPPAataskaitos.preliminariSutartis = true joined to numatomaVerteEUR; n=51 — a small population, " +
            "the honest consequence of frameworks being rare among reported procedures; p50≈300,000, " +
            "p75≈952,467, p90≈3,000,000, p95≈5,156,401) — see README.md.",
    },
    standard: {
        name: 'OLAF-supported Red Flags indicators ("Red Flags" – a New Automatic Warning System, item I.5 "Estimated total value of framework agreement (high)")',
        url: "https://transparency.lt/wp-content/uploads/2018/04/OLAF_Red_Flags_Booklet.pdf",
        page: 9,
    },
    public: {
        titleLt: "Aukšta numatoma preliminariosios sutarties vertė",
        descriptionLt:
            "Pirkimas, kurio ATN-1 (PPA) ataskaita nurodo, kad sudaroma preliminarioji sutartis, o numatoma " +
            "vertė (numatomaVerteEUR) viršija taikomą ribą.",
        formulaLt: "preliminarioji sutartis = taip IR numatomaVerteEUR > taikoma riba",
        limitationLt:
            "ATN-1 (PPA) ataskaitą teikia tik dalis pirkimų (žr. domain-model.md ir LT-OTH-05/README.md), todėl " +
            "didžiajai pirkimų daliai rodiklis grąžins duomenų nepakanka, o ne „ne preliminarioji sutartis“. Tarp " +
            "ataskaitą pateikusių pirkimų preliminariosios sutartys sudaro nedidelę dalį (žr. README.md), todėl " +
            "riba kalibruota pagal nedidelę imtį — ją reikės peržiūrėti, kai duomenų padaugės. Aukšta vertė gali " +
            "būti paaiškinama teisėtu ilgalaikiu ar daugiašaliu preliminariosios sutarties pobūdžiu (ji apima " +
            "kelerių metų ar kelių tiekėjų pirkimus); rodiklis nevertina, ar vertė atitinka pirkimo objektą, o " +
            "tik lygina ją su empiriškai nustatyta riba.",
    },
};
