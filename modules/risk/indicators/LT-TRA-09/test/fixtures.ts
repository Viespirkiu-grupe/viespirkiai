import type { ProcurementProcedureOutcome } from "../../../types.ts";

// elektroninisPirkimas scenarios — Subject.procurement.procedureOutcome,
// the shape the Procurement Reader merges from public.v_pirkimo_pabaiga_v2's
// bool_or'd "elektroninisPirkimas" (modules/risk/procurementReader.ts). Only
// elektroninisPirkimas matters to this indicator; the other fields are
// carried unused, the same way LT-TRA-08's fixtures do for their own unused
// fields.
export function procedureOutcome(elektroninisPirkimas: boolean | null): ProcurementProcedureOutcome {
    return {
        proceduruPabaigos: ["Sudarius pirkimo sutartį"],
        lots: [{ daliesNumeris: "0", proceduruPabaiga: "Sudarius pirkimo sutartį", sprendimoPriemimoData: "2026-01-01", sprendimoPriezastys: null }],
        reportedAt: "2026-01-01",
        preliminariSutartis: null,
        pretenzijaPateikta: null,
        ieskinysTeismui: null,
        elektroninisPirkimas,
    };
}
