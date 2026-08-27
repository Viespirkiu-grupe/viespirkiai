import type { ProcurementProcedureOutcome } from "../../../types.ts";

// courtChallenged scenarios — Subject.procurement.procedureOutcome, the shape
// the Procurement Reader merges from public.v_pirkimo_pabaiga_v2's bool_or'd
// "ieskinysTeismui" (modules/risk/procurementReader.ts). Only
// courtChallenged matters to this indicator; the other fields are carried
// unused, the same way LT-TRA-07's fixtures do for their own unused fields.
export function procedureOutcome(courtChallenged: boolean | null): ProcurementProcedureOutcome {
    return {
        lotOutcomes: ["Sudarius pirkimo sutartį"],
        lots: [{ daliesNumeris: "0", proceduruPabaiga: "Sudarius pirkimo sutartį", sprendimoPriemimoData: "2026-01-01", sprendimoPriezastys: null }],
        reportedAt: "2026-01-01",
        isFramework: null,
        complaintFiled: null,
        courtChallenged,
        electronicProcurement: null,
    };
}
