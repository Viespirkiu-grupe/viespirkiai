import { RelationFactsIndicator } from "../../relationFactsIndicator.ts";
import { ltCom03Decide, type LtCom03Facts } from "./rules.ts";
import { ltCom03Parameters, ltCom03ParametersSchema, type LtCom03Parameters } from "./parameters.ts";

// LT-COM-03 — Only one supplier invited or consulted (Konsultuotas ar
// kviestas tik vienas tiekėjas).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
// collect.sql returns one supplemental fact row per procurement (unioning
// every lot's participants); ltCom03Decide (rules.ts) decides it, so the
// whole definition is a RelationFactsIndicator.
//
// lifecycle: 'shadow'; scope is unscoped pending review — see parameters.ts
// and README.md.
export const ltCom03v1 = new RelationFactsIndicator<LtCom03Facts, LtCom03Parameters>(
    {
        key: { id: "LT-COM-03", version: 1 },
        lifecycle: "shadow",
        subjectType: "procurement",
        stage: "award",
        references: ["STT-I02"],
        sourceRelations: ["public.v_pirkimas_v2", "public.v_dalyviai_v2"],
        requiredInputs: ["tiekejoKodas"],
        parameters: ltCom03Parameters,
        parameterSchema: ltCom03ParametersSchema,
        sqlFile: "./collect.sql",
        factKey: (row) => row.pirkimoNumeris,
        subjectKey: (subject) =>
            subject.subjectType === "procurement" ? subject.procurement.pirkimoNumeris : "",
        methodOf: (row) => row.method,
        missingDataWhenAbsent: ["tiekejoKodas"],
        decide: (_subject, facts, parameters) => ltCom03Decide(facts, parameters),
        standard: {
            name: "STT korupcijos rizikos analizės (STT-I02 — konsultuotas ar kviestas tik vienas tiekėjas)",
            url: "https://www.stt.lt/korupcijos-prevencija/korupcijos-rizikos-analizes/7470",
        },
        public: {
            titleLt: "Konsultuotas ar kviestas tik vienas tiekėjas",
            descriptionLt:
                "Visame pirkime (sudėjus visas jo dalis) ATN-1 ataskaitoje nurodytų skirtingų tiekėjų (dalyvių) " +
                "skaičius, neatsižvelgiant į vėlesnius atmetimus, yra mažesnis už taikomą ribą.",
            formulaLt: "skirtingų tiekėjų (dalyvių) skaičius visame pirkime < taikoma riba",
            limitationLt:
                "Vienas tiekėjas gali būti paaiškinamas siaura rinka, specifiniu pirkimo objektu, teisėtu " +
                "vieno tiekėjo pirkimo būdu arba tuo, kad pirkimas buvo atviras visiems, tačiau pasiūlymą pateikė " +
                "tik vienas tiekėjas. Rodiklis nevertina, ar pirkėjas dirbtinai apribojo, ką kviesti ar " +
                "konsultuoti; kol ATN-1 duomenys apima beveik vien atvirus konkursus, jis dar neskiria kviestų " +
                "ar konsultuotų tiekėjų nuo savarankiškai pasiūlymą pateikusių (žr. README.md).",
        },
    },
    import.meta.url,
);
