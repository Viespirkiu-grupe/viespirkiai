import type { ProcurementProcedureOutcome } from "../../../types.ts";

// Named numatomaVerteEUR scenarios shared by decision.test.ts, in the same
// style as LT-PRI-05's fixtures — the value comes straight from
// Subject.procurement.numatomaVerteEUR.

// Well below the minimumValueEUR: 5_000_000 default — the plain
// not_triggered case (for a subject already known to be a framework).
export const lowValue = 300_000;

// Exactly at the boundary — minimumValueEUR: 5_000_000 does not trigger on
// numatomaVerteEUR === 5_000_000 (strictly greater than, not
// greater-or-equal).
export const boundaryValue = 5_000_000;

// Just above the boundary — the plain triggered case.
export const highValue = 5_156_400.83;

// Far above the boundary — a large, clearly triggered case.
export const veryHighValue = 24_341_864;

// isFramework scenarios — Subject.procurement.procedureOutcome, the shape
// the Procurement Reader merges from public.v_pirkimo_pabaiga_v2's
// bool_or'd "preliminariSutartis" (modules/risk/procurementReader.ts). Only
// isFramework matters to this indicator; the other fields are carried
// unused, the same way LT-OTH-03/04/05's fixtures do for their own unused
// fields.
export function procedureOutcome(isFramework: boolean | null): ProcurementProcedureOutcome {
    return {
        lotOutcomes: ["Sudarius pirkimo sutartį"],
        lots: [{ daliesNumeris: "0", proceduruPabaiga: "Sudarius pirkimo sutartį", sprendimoPriemimoData: "2026-01-01" }],
        reportedAt: "2026-01-01",
        isFramework,
    };
}
