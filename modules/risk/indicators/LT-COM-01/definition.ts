import { SqlRiskIndicator } from "../../sqlRiskIndicator.ts";
import { ltCom01Parameters, ltCom01ParametersContract, type LtCom01Parameters } from "./parameters.ts";

// LT-COM-01 — Single valid bid (Vienintelis tinkamas pasiūlymas).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
// Shape: row-local arithmetic over one subject's own facts
// (risk-service-architecture.md §5.3.1) — one packaged SELECT, so the whole
// definition is a SqlRiskIndicator and there is no calculate.ts.
//
// lifecycle: 'shadow' — the method-scope parameter is a v1 placeholder
// pending review (see parameters.ts), so this version is committed but kept
// out of the public read model until flipped to 'active' (§10.1).
export const ltCom01v1 = new SqlRiskIndicator<LtCom01Parameters>(
    {
        key: { id: "LT-COM-01", version: 1 },
        lifecycle: "shadow",
        subjectType: "lot",
        stage: "award",
        references: ["OCP-R018", "OLAF-CA02", "OT-I01", "STT-I03", "VPT-I01"],
        sourceRelations: ["public.v_pirkimas", "public.v_dalyviai"],
        requiredInputs: ["tiekejoKodas", "atmetimoPriezastis"],
        parameters: ltCom01Parameters,
        parameterContract: ltCom01ParametersContract,
        sqlFile: "./calculate.sql",
        standard: {
            name: "OCP Red Flags in Public Procurement 2024",
            url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
        },
        public: {
            titleLt: "Vienintelis tinkamas pasiūlymas",
            descriptionLt:
                "Pirkimo dalyje po pasiūlymų vertinimo liko tik vienas tinkamas (neatmestas) pasiūlymas.",
            formulaLt: "tinkamų pasiūlymų skaičius (po atmetimų) = 1",
            limitationLt:
                "Vienas tinkamas pasiūlymas gali būti paaiškinamas siaura rinka, specifiniu pirkimo objektu " +
                "arba teisėtu vieno tiekėjo pirkimo būdu. Rodiklis nevertina, ar konkurencijos stoka buvo dirbtinai " +
                "sukelta.",
        },
    },
    import.meta.url,
);
