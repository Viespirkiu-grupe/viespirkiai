import type { BaseParameters, RiskIndicatorDefinition } from "../../types.ts";

// LT-PRO-08 — Short submission/advertisement period (Trumpas pasiūlymų
// pateikimo (skelbimo) laikotarpis).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
export interface LtPro08Parameters extends BaseParameters {
    // Trigger when a procurement's own submission period (pasiulymuPateikimoTerminas
    // minus paskelbimoData, in calendar days) is strictly below this many
    // days — "anomalously short". See decision.ts's submissionPeriodDays().
    readonly minimumDays: number;
    // pirkimoBudas labels excluded from this indicator's population because
    // they are not a competitive tender with a submission-of-tenders
    // deadline — see README.md for why "Rinkos konsultacija" (pre-procurement
    // market consultation) is gated to not_applicable rather than judged.
    readonly excludedProcedures: readonly string[];
}

export const ltPro08Definition: RiskIndicatorDefinition<LtPro08Parameters> = {
    key: { id: "LT-PRO-08", version: 1 },
    subjectType: "procurement",
    stage: "tender",
    references: ["OCP-R003", "OCP-R014", "OLAF-CN29", "OT-I04"],
    sourceRelations: ["public.v_pirkimas_v2"],
    requiredInputs: ["paskelbimoData", "pasiulymuPateikimoTerminas"],
    parameters: {
        validFrom: "2026-01-01",
        validTo: null,
        minimumDays: 5,
        excludedProcedures: ["Rinkos konsultacija"],
        source:
            "OCP Red Flags in Public Procurement 2024 (OCP-R003 'Submission period is too short'), cross-" +
            "referenced against OCP-R014, OLAF-CN29, OT-I04: none of the source booklets state an operational day " +
            "count, so the bound is the empirical 5th-percentile cut point measured 2026-08 against the real " +
            "warehouse population of eligible procurements with a plausible (paskelbimoData, " +
            "pasiulymuPateikimoTerminas) pair, excluding Rinkos konsultacija (saltinis='cvpis', pirkimoBudas not " +
            "null and not 'Rinkos konsultacija'; n=38,655; p05=5 days) — see README.md.",
    },
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Trumpas pasiūlymų pateikimo (skelbimo) laikotarpis",
        descriptionLt:
            "Laikotarpis nuo pirkimo paskelbimo datos (paskelbimoData) iki pasiūlymų pateikimo termino " +
            "(pasiulymuPateikimoTerminas) yra trumpesnis už taikomą ribą — tiekėjams gali nepakakti laiko " +
            "kokybiškai parengti pasiūlymą.",
        formulaLt: "pasiūlymų pateikimo terminas − paskelbimo data (dienomis) < riba",
        limitationLt:
            "Rodiklis skaičiuojamas tik skelbiamiems (cvpis šaltinio) pirkimams, turintiems nurodytą pirkimo " +
            "būdą — likusiems (cvpp šaltinio) pirkimams rodiklis grąžina „netaikoma“, o ne „rizikos nėra“, nes šis " +
            "šaltinis pirkimo būdo apskritai nefiksuoja. Rinkos konsultacijos (pirkimo būdas „Rinkos konsultacija“) " +
            "taip pat žymimos „netaikoma“ — tai ne konkurencinė procedūra su pasiūlymų pateikimo terminu, o " +
            "preliminarus rinkos tyrimas, kurio trumpas atsakymo laikas nėra to paties pobūdžio rizika. Kai " +
            "apskaičiuotas laikotarpis yra neigiamas arba lygus nuliui (paskelbimo data sutampa su terminu arba " +
            "yra vėlesnė už jį — dažniausiai dėl vėliau (pvz., nutraukimo metu) pakartotinai paskelbto to paties " +
            "pirkimo numerio pranešimo, kurio paskelbimo data atnaujinta, o terminas — ne), rodiklis grąžina " +
            "„duomenų nepakanka“, nes tai nėra tikras laikotarpio matavimas. Trumpas laikotarpis gali būti " +
            "paaiškinamas teisėtai pagreitinta procedūra (žr. LT-PRO-05) arba maža, paprasta pirkimo apimtimi, o " +
            "ne piktnaudžiavimu. Riba nustatyta empiriškai iš realių duomenų (žr. README.md), o ne iš teisės akto " +
            "nustatyto minimalaus termino, kuris Lietuvos/ES teisėje skiriasi priklausomai nuo pirkimo būdo.",
    },
};
