import { log } from "../../utils/log.js";
import type { Bid, Lot, LotParticipation, Procurement, ProcurementParticipation, ProcurementProcedureOutcome } from "./types.ts";
import type { RiskDataSource } from "./riskDataSource.ts";
import { PUBLIC_VIEWS_CTE } from "./procurementPublicViews.ts";

// The Procurement Reader (docs/indicators-story/risk-service-architecture-v2.md
// §1.2): loads the subject universe page by page, so a run's working set stays
// bounded regardless of population size. Does no eligibility filtering itself
// — that is procurementEligibility.ts's job, downstream of this, matching the
// DRD diagram's separation of Input Data from Decision.

// Reads the risk service's own _v2 views (modules/mcp/analyst/views/
// v_pirkimas_v2.sql, v_pirkimo_dalis_v2.sql, v_dalyviai_v2.sql) rather than
// the shared analyst views — isolates the Procurement Reader from drift in
// the shared views' column shape (see v_pirkimas_v2.sql's header comment).
// Every query below carries PUBLIC_VIEWS_CTE — that module's header explains
// why these are inlined as a WITH prefix rather than queried as persisted
// views.

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
    ${PUBLIC_VIEWS_CTE}
    SELECT DISTINCT ON (saltinis, "pirkimoNumeris")
           saltinis, "pirkimoNumeris", pavadinimas, "jarKodas", "pirkimoBudas", statusas,
           "pirkimoObjektoTipas", "numatomaVerteEUR", "paskelbimoData", "pasiulymuPateikimoTerminas",
           "bvpzKodai", "esFinansavimas"
    FROM v_pirkimas_v2
    WHERE ($1::text[] IS NULL OR "pirkimoNumeris" = ANY ($1::text[]))
      AND ($2::text IS NULL OR (saltinis, "pirkimoNumeris") > ($2::text, $3::text))
    ORDER BY saltinis, "pirkimoNumeris", "paskelbimoData" DESC NULLS LAST
    LIMIT $4
`;

// The full set of valid pirkimoNumeris values within the run's subjects
// scope, used once (not per page) to tell an orphan lot from a real one —
// see loadLotUniverse() below.
const PROCUREMENT_IDS_SQL = `
    ${PUBLIC_VIEWS_CTE}
    SELECT DISTINCT "pirkimoNumeris"
    FROM v_pirkimas_v2
    WHERE ($1::text[] IS NULL OR "pirkimoNumeris" = ANY ($1::text[]))
`;

const LOT_SQL = `
    ${PUBLIC_VIEWS_CTE}
    SELECT "subjektoRaktas", saltinis, "pirkimoNumeris", "daliesNumeris", "daliesPavadinimas",
           deklaruota, stebeta, "dalyviuSkaicius", "kainuSkaicius", "atmestuSkaicius"
    FROM v_pirkimo_dalis_v2
    WHERE ($1::text[] IS NULL OR "pirkimoNumeris" = ANY ($1::text[]))
`;

// Lot-grain participation facts, merged onto Lot by the Reader and shared by
// every lot-grain indicator (LT-COM-01, LT-COM-02). One row per
// (pirkimoNumeris, daliesNumeris) with at least one participant recorded in
// v_dalyviai_v2 at or before the cutoff.
const LOT_PARTICIPATION_SQL = `
    ${PUBLIC_VIEWS_CTE}
    SELECT d."pirkimoNumeris"                                                            AS "pirkimoNumeris",
           COALESCE(d."daliesNumeris", '0')                                              AS "daliesNumeris",
           count(DISTINCT d."tiekejoKodas")::int                                         AS "totalBids",
           count(DISTINCT d."tiekejoKodas") FILTER (WHERE d."atmetimoPriezastis" IS NULL)::int
                                                                                          AS "validBids",
           to_char(max(d."ataskaitosData") AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                          AS "reportedAt"
    FROM v_dalyviai_v2 d
    WHERE d."ataskaitosData" <= $1::timestamptz
      AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
    GROUP BY d."pirkimoNumeris", COALESCE(d."daliesNumeris", '0')
`;

// Procurement-grain participation facts — the cross-lot union: a supplier
// bidding on two lots of the same procurement counts once, not twice. No
// "method" column here — a lot's (and a procurement's) method is
// Procurement.pirkimoBudas, never derived from the ATN-1 report itself.
const PROCUREMENT_PARTICIPATION_SQL = `
    ${PUBLIC_VIEWS_CTE}
    SELECT d."pirkimoNumeris"                                                            AS "pirkimoNumeris",
           count(DISTINCT d."tiekejoKodas")::int                                         AS "totalSuppliers",
           to_char(max(d."ataskaitosData") AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                          AS "reportedAt"
    FROM v_dalyviai_v2 d
    WHERE d."ataskaitosData" <= $1::timestamptz
      AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
    GROUP BY d."pirkimoNumeris"
`;

// Bid-grain rows for Lot.bids — one per (pirkimoNumeris, daliesNumeris,
// tiekejoKodas), the "bid" SubjectType's grain (docs/indicators-story/
// indicators-canonical.md §4's "Bid / bidder participation" subject
// register). Distinct from LOT_PARTICIPATION_SQL's aggregate counts: this is
// the individual bidder row a bid-grain indicator judges. Only rows with a
// non-null tiekejoKodas are loaded — a null-coded participant has no durable
// key to attach a Bid subject to; it is already represented in
// LotParticipation's totalBids/validBids=0 case.
//
// DISTINCT ON collapses duplicate xlsxPPAdalyviai/xlsxPPAatmestiPasiulymai
// rows for the same bidder (a real data-quality issue — the same rejection
// entered twice with an identical ataskaitosData) down to one, preferring
// whichever duplicate actually carries an outcome (a ranking or a rejection
// status) over a duplicate that carries neither.
const LOT_BIDS_SQL = `
    ${PUBLIC_VIEWS_CTE}
    SELECT DISTINCT ON (d."pirkimoNumeris", COALESCE(d."daliesNumeris", '0'), d."tiekejoKodas")
           d."pirkimoNumeris"                                                          AS "pirkimoNumeris",
           COALESCE(d."daliesNumeris", '0')                                            AS "daliesNumeris",
           d."tiekejoKodas"                                                            AS "tiekejoKodas",
           d."eileNumeris"                                                             AS "eileNumeris",
           d."pasiulymoKaina"                                                          AS "pasiulymoKaina",
           d."atmetimoPriezastis"                                                      AS "atmetimoPriezastis",
           d."atmetimoStatusas"                                                        AS "atmetimoStatusas",
           to_char(d."ataskaitosData" AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                        AS "reportedAt"
    FROM v_dalyviai_v2 d
    WHERE d."ataskaitosData" <= $1::timestamptz
      AND d."tiekejoKodas" IS NOT NULL
      AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
    ORDER BY d."pirkimoNumeris", COALESCE(d."daliesNumeris", '0'), d."tiekejoKodas",
             (d."eileNumeris" IS NOT NULL OR d."atmetimoStatusas" IS NOT NULL OR d."atmetimoPriezastis" IS NOT NULL) DESC,
             d."ataskaitosData" DESC
`;

// Procurement-grain procedure-ending outcomes — every distinct
// "proceduruPabaiga" label observed across the procurement's lots, shared by
// every procurement-grain indicator that judges the procedure's outcome
// (currently LT-OTH-05). array_agg(DISTINCT ...) collapses repeated labels
// across lots (and across the rare duplicate report) to the set an
// indicator actually needs to test membership against.
//
// "lots" carries the same rows at their natural per-lot grain instead —
// (daliesNumeris, proceduruPabaiga, sprendimoPriemimoData) triples, one per
// procedure-ending row observed — for LT-OTH-03, which needs a lot's own
// decision date paired with its own outcome label rather than the collapsed
// cross-lot set lotOutcomes/reportedAt provide. json_agg is never null here:
// the JOIN in v_pirkimo_pabaiga_v2 guarantees at least one row per group.
const PROCEDURE_OUTCOME_SQL = `
    ${PUBLIC_VIEWS_CTE}
    SELECT po."pirkimoNumeris"                                                            AS "pirkimoNumeris",
           array_agg(DISTINCT po."proceduruPabaiga")                                       AS "lotOutcomes",
           json_agg(json_build_object(
               'daliesNumeris', po."daliesNumeris",
               'proceduruPabaiga', po."proceduruPabaiga",
               'sprendimoPriemimoData', to_char(po."sprendimoPriemimoData", 'YYYY-MM-DD')
           ))                                                                              AS "lots",
           to_char(max(po."sprendimoPriemimoData"), 'YYYY-MM-DD')                          AS "reportedAt"
    FROM v_pirkimo_pabaiga_v2 po
    WHERE po."ataskaitosData" <= $1::timestamptz
      AND ($2::text[] IS NULL OR po."pirkimoNumeris" = ANY ($2::text[]))
    GROUP BY po."pirkimoNumeris"
`;

export type Page<T> = Readonly<{
    items: readonly T[];
    nextCursor: string | null;
}>;

type LotRow = Omit<Lot, "participation" | "bids">;
type LotParticipationRow = Readonly<{ pirkimoNumeris: string; daliesNumeris: string }> & LotParticipation;
type ProcurementParticipationRow = Readonly<{ pirkimoNumeris: string }> & ProcurementParticipation;
type ProcedureOutcomeRow = Readonly<{ pirkimoNumeris: string }> & ProcurementProcedureOutcome;
type BidRow = Readonly<{ pirkimoNumeris: string; daliesNumeris: string }> & Bid;

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
    private procedureOutcomeByNumber: Map<string, ProcurementProcedureOutcome> | null = null;
    private orphanLotCount = 0;

    constructor(data: RiskDataSource, subjects: readonly string[] | null, dataAsOf: string) {
        this.data = data;
        this.subjects = subjects;
        this.dataAsOf = dataAsOf;
    }

    /**
     * Lots whose pirkimoNumeris matched no procurement in this run's scope —
     * dropped rather than surfaced as a Subject (see ensureLotUniverseLoaded's
     * own comment). Always 0 before the first loadProcurements() call; stable
     * afterwards, since the whole lot universe loads once, not per page.
     */
    get droppedOrphanLotCount(): number {
        return this.orphanLotCount;
    }

    async loadProcurements(cursor: string | null, pageSize: number): Promise<Page<Procurement>> {
        await this.ensureLotUniverseLoaded();

        const [cursorSaltinis, cursorPirkimoNumeris] = cursor === null ? [null, null] : decodeCursor(cursor);
        const rows = await this.data.query<Omit<Procurement, "lots" | "participation" | "procedureOutcome">>(PROCUREMENT_SQL, [
            this.subjects,
            cursorSaltinis,
            cursorPirkimoNumeris,
            pageSize,
        ]);

        const items: Procurement[] = rows.map((row) => ({
            ...row,
            lots: this.lotsByNumber!.get(row.pirkimoNumeris) ?? [],
            participation: this.procurementParticipationByNumber!.get(row.pirkimoNumeris) ?? null,
            procedureOutcome: this.procedureOutcomeByNumber!.get(row.pirkimoNumeris) ?? null,
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

        const [procurementIds, lotRows, lotParticipationRows, procurementParticipationRows, bidRows, procedureOutcomeRows] =
            await Promise.all([
                this.data.query<{ pirkimoNumeris: string }>(PROCUREMENT_IDS_SQL, [this.subjects]),
                this.data.query<LotRow>(LOT_SQL, [this.subjects]),
                this.data.query<LotParticipationRow>(LOT_PARTICIPATION_SQL, [this.dataAsOf, this.subjects]),
                this.data.query<ProcurementParticipationRow>(PROCUREMENT_PARTICIPATION_SQL, [this.dataAsOf, this.subjects]),
                this.data.query<BidRow>(LOT_BIDS_SQL, [this.dataAsOf, this.subjects]),
                this.data.query<ProcedureOutcomeRow>(PROCEDURE_OUTCOME_SQL, [this.dataAsOf, this.subjects]),
            ]);

        const validIds = new Set(procurementIds.map((row) => row.pirkimoNumeris));

        const lotParticipationByKey = new Map<string, LotParticipation>(
            lotParticipationRows.map((row) => [
                `${row.pirkimoNumeris}:${row.daliesNumeris}`,
                { totalBids: row.totalBids, validBids: row.validBids, reportedAt: row.reportedAt },
            ]),
        );

        const bidsByLotKey = new Map<string, Bid[]>();
        for (const row of bidRows) {
            const key = `${row.pirkimoNumeris}:${row.daliesNumeris}`;
            const bucket = bidsByLotKey.get(key) ?? [];
            bucket.push({
                tiekejoKodas: row.tiekejoKodas,
                eileNumeris: row.eileNumeris,
                pasiulymoKaina: row.pasiulymoKaina,
                atmetimoPriezastis: row.atmetimoPriezastis,
                atmetimoStatusas: row.atmetimoStatusas,
                reportedAt: row.reportedAt,
            });
            bidsByLotKey.set(key, bucket);
        }

        const lotsByNumber = new Map<string, Lot[]>();
        let orphanCount = 0;
        for (const row of lotRows) {
            if (!validIds.has(row.pirkimoNumeris)) {
                orphanCount++;
                continue;
            }
            const key = `${row.pirkimoNumeris}:${row.daliesNumeris}`;
            const lot: Lot = {
                ...row,
                participation: lotParticipationByKey.get(key) ?? null,
                bids: bidsByLotKey.get(key) ?? [],
            };
            const bucket = lotsByNumber.get(row.pirkimoNumeris) ?? [];
            bucket.push(lot);
            lotsByNumber.set(row.pirkimoNumeris, bucket);
        }
        if (orphanCount > 0) {
            log(`procurementReader: dropped ${orphanCount} orphan lot(s) with no matching procurement`);
        }
        this.orphanLotCount = orphanCount;

        this.lotsByNumber = lotsByNumber;
        this.procurementParticipationByNumber = new Map(
            procurementParticipationRows.map((row) => [
                row.pirkimoNumeris,
                { totalSuppliers: row.totalSuppliers, reportedAt: row.reportedAt },
            ]),
        );
        this.procedureOutcomeByNumber = new Map(
            procedureOutcomeRows.map((row) => [
                row.pirkimoNumeris,
                { lotOutcomes: row.lotOutcomes, lots: row.lots, reportedAt: row.reportedAt },
            ]),
        );
    }
}
