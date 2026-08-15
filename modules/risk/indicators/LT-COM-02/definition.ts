import { SubjectFactsIndicator } from "../../subjectFactsIndicator.ts";
import { ltCom02Decide, type LtCom02Facts } from "./rules.ts";
import { ltCom02Parameters, ltCom02ParametersSchema, type LtCom02Parameters } from "./parameters.ts";

// LT-COM-02 — Low number of bidders (Mažas dalyvių skaičius).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
// Shape: row-local — collect.sql returns one fact row per lot and
// ltCom02Decide decides it (risk-service-architecture.md §4.4), so the whole
// definition is a SubjectFactsIndicator.
//
// lifecycle: 'shadow' — the method scope is a v1 placeholder pending review
// (see parameters.ts and README.md, "Open question: method scope"), so this
// version is committed but kept out of the public read model until flipped to
// 'active' (§7.2).
export const ltCom02v1 = new SubjectFactsIndicator<LtCom02Facts, LtCom02Parameters>(
    {
        key: { id: "LT-COM-02", version: 1 },
        lifecycle: "shadow",
        subjectType: "lot",
        stage: "award",
        references: ["OCP-R019", "OLAF-CN01", "OLAF-CN02", "OLAF-CA02", "VPT-I12"],
        sourceRelations: ["public.v_lot", "public.v_dalyviai"],
        requiredInputs: ["tiekejoKodas"],
        parameters: ltCom02Parameters,
        parameterSchema: ltCom02ParametersSchema,
        sqlFile: "./collect.sql",
        decide: ltCom02Decide,
        standard: {
            name: "OCP Red Flags in Public Procurement 2024",
            url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
        },
        public: {
            titleLt: "Mažas dalyvių skaičius",
            descriptionLt:
                "Pirkimo dalyje ATN-1 ataskaitoje nurodytų dalyvių (tiekėjų) skaičius, neatsižvelgiant į vėlesnius " +
                "atmetimus, yra mažesnis už taikomą ribą.",
            formulaLt: "dalyvių (tiekėjų) skaičius < taikoma riba",
            limitationLt:
                "Mažas dalyvių skaičius gali būti paaiškinamas siaura rinka, specifiniu pirkimo objektu arba " +
                "aukštais kvalifikaciniais reikalavimais. Rodiklis nevertina, ar konkurencijos stoka buvo dirbtinai " +
                "sukelta, ir nevertina, ar dalyvių pasiūlymai vėliau liko galioti (tam skirtas LT-COM-01).",
        },
    },
    import.meta.url,
);
