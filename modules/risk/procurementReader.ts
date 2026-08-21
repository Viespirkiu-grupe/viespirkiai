import { log } from "../../utils/log.js";
import type { Lot, LotParticipation, Procurement, ProcurementParticipation } from "./types.ts";
import type { RiskDataSource } from "./riskDataSource.ts";

// The Procurement Reader (docs/indicators-story/risk-service-architecture-v2.md
// §1.2): loads the subject universe page by page, so a run's working set stays
// bounded regardless of population size. Does no eligibility filtering itself
// — that is procurementEligibility.ts's job, downstream of this, matching the
// DRD diagram's separation of Input Data from Decision.

// Queries the risk service's own _v2 views (modules/mcp/analyst/views/
// v_pirkimas_v2.sql, v_pirkimo_dalis_v2.sql, v_dalyviai_v2.sql) rather than
// the shared analyst views — isolates the Procurement Reader from drift in
// the shared views' column shape (see v_pirkimas_v2.sql's header comment).

// DISTINCT ON (saltinis, "pirkimoNumeris") guards against a duplicate notice
// on the cvpp side: cvppViesiejiPirkimai is keyed by skelbimoKodas, not
// pirkimoNumeris, so nothing stops two announcements naming the same
// pirkimoNumeris from both surviving the view's UNION ALL. Keeping the most
// recently published of any such pair (ORDER BY ... "paskelbimoData" DESC)
// also gives the keyset cursor below a genuinely unique, stable key to page
// on — a plain (saltinis, pirkimoNumeris) > (cursor) predicate would
// otherwise risk skipping or repeating a row across a page boundary if a
// duplicate ever appears.
const PROCUREMENT_SQL = `
    SELECT DISTINCT ON (saltinis, "pirkimoNumeris")
           saltinis, "pirkimoNumeris", pavadinimas, "jarKodas", "pirkimoBudas", statusas,
           "pirkimoObjektoTipas", "numatomaVerteEUR", "paskelbimoData", "pasiulymuPateikimoTerminas",
           "bvpzKodai", "esFinansavimas"
    FROM public.v_pirkimas_v2
    WHERE ($1::text[] IS NULL OR "pirkimoNumeris" = ANY ($1::text[]))
      AND ($2::text IS NULL OR (saltinis, "pirkimoNumeris") > ($2::text, $3::text))
    ORDER BY saltinis, "pirkimoNumeris", "paskelbimoData" DESC NULLS LAST
    LIMIT $4
`;

// The full set of valid pirkimoNumeris values within the run's subjects
// scope, used once (not per page) to tell an orphan lot from a real one —
// see loadLotUniverse() below.
const PROCUREMENT_IDS_SQL = `
    SELECT DISTINCT "pirkimoNumeris"
    FROM public.v_pirkimas_v2
    WHERE ($1::text[] IS NULL OR "pirkimoNumeris" = ANY ($1::text[]))
`;

const LOT_SQL = `
    SELECT "subjektoRaktas", saltinis, "pirkimoNumeris", "daliesNumeris", "daliesPavadinimas",
           deklaruota, stebeta, "dalyviuSkaicius", "kainuSkaicius", "atmestuSkaicius"
    FROM public.v_pirkimo_dalis_v2
    WHERE ($1::text[] IS NULL OR "pirkimoNumeris" = ANY ($1::text[]))
`;

// Lot-grain participation facts, merged onto Lot by the Reader. Consolidates
// what LT-COM-01's and LT-COM-02's former per-indicator collect.sql each
// computed independently (identical GROUP BY; LT-COM-01 was simply a
// superset that also filtered on atmetimoPriezastis). One row per
// (pirkimoNumeris, daliesNumeris) with at least one participant recorded in
// v_dalyviai_v2 at or before the cutoff.
const LOT_PARTICIPATION_SQL = `
    SELECT d."pirkimoNumeris"                                                            AS "pirkimoNumeris",
           COALESCE(d."daliesNumeris", '0')                                              AS "daliesNumeris",
           count(DISTINCT d."tiekejoKodas")::int                                         AS "totalBids",
           count(DISTINCT d."tiekejoKodas") FILTER (WHERE d."atmetimoPriezastis" IS NULL)::int
                                                                                          AS "validBids",
           to_char(max(d."ataskaitosData") AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                          AS "reportedAt"
    FROM public.v_dalyviai_v2 d
    WHERE d."ataskaitosData" <= $1::timestamptz
      AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
    GROUP BY d."pirkimoNumeris", COALESCE(d."daliesNumeris", '0')
`;

// Procurement-grain participation facts — the cross-lot union LT-COM-03's
// former collect.sql computed: a supplier bidding on two lots of the same
// procurement counts once, not twice. No "method" column here — a lot's
// (and a procurement's) method is Procurement.pirkimoBudas, never derived
// from the ATN-1 report itself.
const PROCUREMENT_PARTICIPATION_SQL = `
    SELECT d."pirkimoNumeris"                                                            AS "pirkimoNumeris",
           count(DISTINCT d."tiekejoKodas")::int                                         AS "totalSuppliers",
           to_char(max(d."ataskaitosData") AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                          AS "reportedAt"
    FROM public.v_dalyviai_v2 d
    WHERE d."ataskaitosData" <= $1::timestamptz
      AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
    GROUP BY d."pirkimoNumeris"
`;

export type Page<T> = Readonly<{
    items: readonly T[];
    nextCursor: string | null;
}>;

type LotRow = Omit<Lot, "participation">;
type LotParticipationRow = Readonly<{ pirkimoNumeris: string; daliesNumeris: string }> & LotParticipation;
type ProcurementParticipationRow = Readonly<{ pirkimoNumeris: string }> & ProcurementParticipation;

function encodeCursor(saltinis: string, pirkimoNumeris: string): string {
    return `${saltinis}\u0000${pirkimoNumeris}`;
}

function decodeCursor(cursor: string): readonly [string, string] {
    const [saltinis, pirkimoNumeris] = cursor.split("\u0000");
    return [saltinis, pirkimoNumeris];
}

/**
 * Loads the Procurement/Lot subject universe page by page. `subjects` and
 * `dataAsOf` are bound once per instance — the same scope every page and
 * every participation query shares — rather than passed per call, so lots
 * and participation facts (below) can be loaded once for the whole run
 * instead of re-queried per page.
 */
export class ProcurementReader {
    private readonly data: RiskDataSource;
    private readonly subjects: readonly string[] | null;
    private readonly dataAsOf: string;

    // Built once, lazily, on the first loadProcurements() call — see
    // ensureLotUniverseLoaded().
    private lotsByNumber: Map<string, Lot[]> | null = null;
    private procurementParticipationByNumber: Map<string, ProcurementParticipation> | null = null;

    constructor(data: RiskDataSource, subjects: readonly string[] | null, dataAsOf: string) {
        this.data = data;
        this.subjects = subjects;
        this.dataAsOf = dataAsOf;
    }

    async loadProcurements(cursor: string | null, pageSize: number): Promise<Page<Procurement>> {
        await this.ensureLotUniverseLoaded();

        const [cursorSaltinis, cursorPirkimoNumeris] = cursor === null ? [null, null] : decodeCursor(cursor);
        const rows = await this.data.query<Omit<Procurement, "lots" | "participation">>(PROCUREMENT_SQL, [
            this.subjects,
            cursorSaltinis,
            cursorPirkimoNumeris,
            pageSize,
        ]);

        const items: Procurement[] = rows.map((row) => ({
            ...row,
            lots: this.lotsByNumber!.get(row.pirkimoNumeris) ?? [],
            participation: this.procurementParticipationByNumber!.get(row.pirkimoNumeris) ?? null,
        }));

        // last.saltinis is asserted non-null: v_pirkimas_v2's saltinis is
        // always the literal 'cvpis' or 'cvpp' (see its own SQL), the
        // Procurement type's `string | null` only reflects a downstream
        // orphan-lot case that never applies to a Procurement row itself.
        const last = rows[rows.length - 1];
        const nextCursor = rows.length === pageSize && last ? encodeCursor(last.saltinis!, last.pirkimoNumeris) : null;

        return { items, nextCursor };
    }

    /**
     * Runs LOT_SQL and both participation queries exactly once per instance,
     * scoped by the same subjects/dataAsOf every page shares, and caches the
     * merged result. A page-scoped lot query (bound to only that page's
     * pirkimoNumeris values) could never observe a mismatch against
     * PROCUREMENT_SQL, so orphan-lot detection needs the full universe up
     * front, not a per-page slice.
     */
    private async ensureLotUniverseLoaded(): Promise<void> {
        if (this.lotsByNumber !== null) return;

        const [procurementIds, lotRows, lotParticipationRows, procurementParticipationRows] = await Promise.all([
            this.data.query<{ pirkimoNumeris: string }>(PROCUREMENT_IDS_SQL, [this.subjects]),
            this.data.query<LotRow>(LOT_SQL, [this.subjects]),
            this.data.query<LotParticipationRow>(LOT_PARTICIPATION_SQL, [this.dataAsOf, this.subjects]),
            this.data.query<ProcurementParticipationRow>(PROCUREMENT_PARTICIPATION_SQL, [this.dataAsOf, this.subjects]),
        ]);

        const validIds = new Set(procurementIds.map((row) => row.pirkimoNumeris));

        const lotParticipationByKey = new Map<string, LotParticipation>(
            lotParticipationRows.map((row) => [
                `${row.pirkimoNumeris}:${row.daliesNumeris}`,
                { totalBids: row.totalBids, validBids: row.validBids, reportedAt: row.reportedAt },
            ]),
        );

        const lotsByNumber = new Map<string, Lot[]>();
        let orphanCount = 0;
        for (const row of lotRows) {
            if (!validIds.has(row.pirkimoNumeris)) {
                orphanCount++;
                continue;
            }
            const lot: Lot = {
                ...row,
                participation: lotParticipationByKey.get(`${row.pirkimoNumeris}:${row.daliesNumeris}`) ?? null,
            };
            const bucket = lotsByNumber.get(row.pirkimoNumeris) ?? [];
            bucket.push(lot);
            lotsByNumber.set(row.pirkimoNumeris, bucket);
        }
        if (orphanCount > 0) {
            log(`procurementReader: dropped ${orphanCount} orphan lot(s) with no matching procurement`);
        }

        this.lotsByNumber = lotsByNumber;
        this.procurementParticipationByNumber = new Map(
            procurementParticipationRows.map((row) => [
                row.pirkimoNumeris,
                { totalSuppliers: row.totalSuppliers, reportedAt: row.reportedAt },
            ]),
        );
    }
}
