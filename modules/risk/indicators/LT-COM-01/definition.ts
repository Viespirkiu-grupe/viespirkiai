import type { RiskIndicatorDefinition } from "../../types.ts";

// LT-COM-01 — Single valid bid (Vienintelis tinkamas pasiūlymas).
// Source catalogue: docs/indicators-story/indicators-canonical.md.
//
// lifecycle: 'shadow' pending review.

export type LtCom01Parameters = Readonly<{
    maximumValidBids: number;
}>;

export const ltCom01Definition: RiskIndicatorDefinition<LtCom01Parameters> = {
    key: { id: "LT-COM-01", version: 1 },
    lifecycle: "shadow",
    subjectType: "lot",
    stage: "award",
    references: ["OCP-R018", "OLAF-CA02", "OT-I01", "STT-I03", "VPT-I01"],
    sourceRelations: ["public.v_pirkimo_dalis_v2", "public.v_dalyviai_v2"],
    requiredInputs: ["tiekejoKodas", "atmetimoPriezastis"],
    parameters: [
        {
            validFrom: "2026-01-01",
            validTo: null,
            maximumValidBids: 1,
            source: "OCP Red Flags in Public Procurement 2024 (OCP-R018), catalogue definition",
        },
    ],
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
