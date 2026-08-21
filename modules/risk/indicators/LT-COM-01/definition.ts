import type { RiskIndicatorDefinition } from "../../types.ts";
import { ltCom01Parameters, ltCom01ParametersSchema, type LtCom01Parameters } from "./parameters.ts";

// LT-COM-01 — Single valid bid (Vienintelis tinkamas pasiūlymas).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
//
// lifecycle: 'shadow'; scope is unscoped pending review — see parameters.ts.
export const ltCom01Definition: RiskIndicatorDefinition<LtCom01Parameters> = {
    key: { id: "LT-COM-01", version: 1 },
    lifecycle: "shadow",
    subjectType: "lot",
    stage: "award",
    references: ["OCP-R018", "OLAF-CA02", "OT-I01", "STT-I03", "VPT-I01"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "atmetimoPriezastis"],
    parameters: ltCom01Parameters,
    parameterSchema: ltCom01ParametersSchema,
    standard: {
        name: "OCP Red Flags in Public Procurement 2024",
        url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
    },
    public: {
        titleLt: "Vienintelis tinkamas pasiūlymas",
        descriptionLt: "Pirkimo dalyje po pasiūlymų vertinimo liko tik vienas tinkamas (neatmestas) pasiūlymas.",
        formulaLt: "tinkamų pasiūlymų skaičius (po atmetimų) ≤ taikoma riba",
        limitationLt:
            "Vienas tinkamas pasiūlymas gali būti paaiškinamas siaura rinka, specifiniu pirkimo objektu " +
            "arba teisėtu vieno tiekėjo pirkimo būdu. Rodiklis nevertina, ar konkurencijos stoka buvo dirbtinai " +
            "sukelta.",
    },
};
