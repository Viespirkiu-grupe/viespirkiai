import type { RiskIndicatorDefinition } from "../../types.ts";
import { ltCom02Parameters, ltCom02ParametersSchema, type LtCom02Parameters } from "./parameters.ts";

// LT-COM-02 — Low number of bidders (Mažas dalyvių skaičius).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
//
// lifecycle: 'shadow'; scope is unscoped pending review — see parameters.ts
// and README.md.
export const ltCom02Definition: RiskIndicatorDefinition<LtCom02Parameters> = {
    key: { id: "LT-COM-02", version: 1 },
    lifecycle: "shadow",
    subjectType: "lot",
    stage: "award",
    references: ["OCP-R019", "OLAF-CN01", "OLAF-CN02", "OLAF-CA02", "VPT-I12"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas"],
    parameters: ltCom02Parameters,
    parameterSchema: ltCom02ParametersSchema,
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
};
