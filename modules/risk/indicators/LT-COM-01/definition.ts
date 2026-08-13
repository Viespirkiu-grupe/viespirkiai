import { RowLocalSqlIndicator } from "../../rowLocalSqlIndicator.ts";
import { ltCom01Verdict, type LtCom01Facts } from "./calculate.ts";
import { ltCom01Parameters, ltCom01ParametersContract, type LtCom01Parameters } from "./parameters.ts";

// LT-COM-01 — Single valid bid (Vienintelis tinkamas pasiūlymas).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
// Shape: row-local — collect.sql returns one fact row per lot and
// ltCom01Verdict judges it (risk-service-architecture.md §5.3.1), so the whole
// definition is a RowLocalSqlIndicator.
//
// lifecycle: 'shadow' — the method scope is a v1 placeholder pending review
// (see parameters.ts), so this version is committed but kept out of the public
// read model until flipped to 'active' (§10.1).
export const ltCom01v1 = new RowLocalSqlIndicator<LtCom01Facts, LtCom01Parameters>(
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
        sqlFile: "./collect.sql",
        verdict: ltCom01Verdict,
        standard: {
            name: "OCP Red Flags in Public Procurement 2024",
            url: "https://www.open-contracting.org/wp-content/uploads/2024/12/OCP2024-RedFlagProcurement.pdf",
        },
        public: {
            titleLt: "Vienintelis tinkamas pasiūlymas",
            descriptionLt:
                "Pirkimo dalyje po pasiūlymų vertinimo liko tik vienas tinkamas (neatmestas) pasiūlymas.",
            formulaLt: "tinkamų pasiūlymų skaičius (po atmetimų) ≤ taikoma riba",
            limitationLt:
                "Vienas tinkamas pasiūlymas gali būti paaiškinamas siaura rinka, specifiniu pirkimo objektu " +
                "arba teisėtu vieno tiekėjo pirkimo būdu. Rodiklis nevertina, ar konkurencijos stoka buvo dirbtinai " +
                "sukelta.",
        },
    },
    import.meta.url,
);
