// The one rule the `risk` schema's storage layer needs on both the write
// (services/procurement-risk/write.ts) and the read
// (procurementDecisionsReader.ts) side. No DB access. See
// migrations/risk/002_riskNarrow.sql §1.

// The analyst views (modules/mcp/analyst/views/v_pirkimas_v2.sql and friends)
// and the MCP contract spell the CVP IS source 'cvpis'; the `risk` schema
// follows the repo's camelCase convention and stores 'cvpIs'. This map is the
// only place the two spellings meet — renaming the value in the analyst views
// would break the MCP tool contract and the rest of the site, so it is not
// done there. 'cvpp' needs no mapping, and a missing saltinis becomes the
// 'unknown' source (riskDecisionEngine.ts's own fallback).
const riskSourceBySaltinis: ReadonlyMap<string, string> = new Map([["cvpis", "cvpIs"]]);

/** Analyst-view `saltinis` -> risk."procurementSources"."code". */
export function riskProcurementSource(saltinis: string | null | undefined): string {
    if (!saltinis) return "unknown";
    return riskSourceBySaltinis.get(saltinis) ?? saltinis;
}
