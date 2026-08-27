import type { ProcurementProcedureOutcome } from "../../../types.ts";

// complaintFiled scenarios — Subject.procurement.procedureOutcome, the shape
// the Procurement Reader merges from public.v_pirkimo_pabaiga_v2's bool_or'd
// "pretenzijaPateikta" (modules/risk/procurementReader.ts). Only
// complaintFiled matters to this indicator; the other fields are carried
// unused, the same way LT-PRI-06's fixtures do for their own unused fields.
export function procedureOutcome(complaintFiled: boolean | null): ProcurementProcedureOutcome {
    return {
        lotOutcomes: ["Sudarius pirkimo sutartį"],
        lots: [{ daliesNumeris: "0", proceduruPabaiga: "Sudarius pirkimo sutartį", sprendimoPriemimoData: "2026-01-01", sprendimoPriezastys: null }],
        reportedAt: "2026-01-01",
        isFramework: null,
        complaintFiled,
        courtChallenged: null,
        electronicProcurement: null,
    };
}
