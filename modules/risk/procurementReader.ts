import type { Lot, LotSubject, Procurement, ProcurementSubject } from "./types.ts";
import type { RiskDataSource } from "./riskDataSource.ts";

// The Procurement Reader (docs/indicators-story/risk-service-architecture-v2.md
// §1): loads the whole subject universe once per run, in two batched queries
// (not one per subject or per indicator), so query count stays flat
// regardless of population size. Does no eligibility filtering itself — that
// is procurementEligibility.ts's job, downstream of this, matching the DRD
// diagram's separation of Input Data from Decision.

// Queries the risk service's own _v2 views (modules/mcp/analyst/views/
// v_pirkimas_v2.sql, v_pirkimo_dalis_v2.sql) rather than the shared analyst
// v_pirkimas/v_pirkimo_dalis — isolates the Procurement Reader from drift in
// the shared views' column shape (see v_pirkimas_v2.sql's header comment).

const PROCUREMENT_SQL = `
    SELECT saltinis, "pirkimoNumeris", pavadinimas, "jarKodas", "pirkimoBudas", statusas,
           "pirkimoObjektoTipas", "numatomaVerteEUR", "paskelbimoData", "pasiulymuPateikimoTerminas",
           "bvpzKodai", "esFinansavimas"
    FROM public.v_pirkimas_v2
    WHERE ($1::text[] IS NULL OR "pirkimoNumeris" = ANY ($1::text[]))
`;

const LOT_SQL = `
    SELECT "subjektoRaktas", saltinis, "pirkimoNumeris", "daliesNumeris", "daliesPavadinimas",
           deklaruota, stebeta, "dalyviuSkaicius", "kainuSkaicius", "atmestuSkaicius"
    FROM public.v_pirkimo_dalis_v2
    WHERE ($1::text[] IS NULL OR "pirkimoNumeris" = ANY ($1::text[]))
`;

export type ProcurementReaderResult = Readonly<{
    procurementSubjects: readonly ProcurementSubject[];
    lotSubjects: readonly LotSubject[];
}>;

/**
 * `subjects`: the same pirkimoNumeris scope services/procurement-risk/index.ts
 * already resolves (explicit ids, a --limit sample, or null for a full run).
 */
export async function loadProcurements(
    data: RiskDataSource,
    subjects: readonly string[] | null,
): Promise<ProcurementReaderResult> {
    const [procurementRows, lotRows] = await Promise.all([
        data.query<Omit<Procurement, "lots">>(PROCUREMENT_SQL, [subjects]),
        data.query<Lot>(LOT_SQL, [subjects]),
    ]);

    const lotsByNumber = new Map<string, Lot[]>();
    for (const lot of lotRows) {
        const bucket = lotsByNumber.get(lot.pirkimoNumeris) ?? [];
        bucket.push(lot);
        lotsByNumber.set(lot.pirkimoNumeris, bucket);
    }

    const procurementsByNumber = new Map<string, Procurement>();
    for (const row of procurementRows) {
        procurementsByNumber.set(row.pirkimoNumeris, {
            ...row,
            lots: lotsByNumber.get(row.pirkimoNumeris) ?? [],
        });
    }

    const procurementSubjects: ProcurementSubject[] = [...procurementsByNumber.values()].map((procurement) => ({
        subjectType: "procurement",
        subjectKey: `${procurement.saltinis ?? "unknown"}:${procurement.pirkimoNumeris}`,
        procurementSource: procurement.saltinis,
        procurementId: procurement.pirkimoNumeris,
        procurement,
    }));

    // procurement is null for an orphan lot — no v_pirkimas row for its
    // pirkimoNumeris. See contracts.ts's LotSubject.
    const lotSubjects: LotSubject[] = lotRows.map((lot) => ({
        subjectType: "lot",
        subjectKey: lot.subjektoRaktas,
        procurementSource: lot.saltinis,
        procurementId: lot.pirkimoNumeris,
        lot,
        procurement: procurementsByNumber.get(lot.pirkimoNumeris) ?? null,
    }));

    return { procurementSubjects, lotSubjects };
}
