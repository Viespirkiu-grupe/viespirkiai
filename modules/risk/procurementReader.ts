import { log } from "../../utils/log.js";
import type { Bid, Lot, LotParticipation, Procurement, ProcurementParticipation, ProcurementProcedureOutcome } from "./types.ts";
import type { RiskDataSource } from "./riskDataSource.ts";
import { publicViewsCte } from "./procurementPublicViews.ts";

// The Procurement Reader (docs/indicators-story/risk-service-architecture-v2.md
// §1.2): loads the subject universe page by page, so a run's working set stays
// bounded regardless of population size. Does no eligibility filtering itself
// — that is procurementEligibility.ts's job, downstream of this, matching the
// DRD diagram's separation of Input Data from Decision.

// Reads the risk service's own _v2 views (modules/mcp/analyst/views/
// v_pirkimas_v2.sql, v_pirkimo_dalis_v2.sql, v_dalyviai_v2.sql) rather than
// the shared analyst views — isolates the Procurement Reader from drift in
// the shared views' column shape (see v_pirkimas_v2.sql's header comment).
// Every query below opens with publicViewsCte(...) — that module's header
// explains why these are inlined as a WITH prefix rather than queried as
// persisted views, and why each query must name only the views it actually
// reads.

// Scopes a read of v_pirkimas_v2 to a set of procurements without ever making
// Postgres seq-scan viesiejiPirkimai. The view's "pirkimoNumeris" is
// p."pirkimoId"::text, and no index can serve a predicate on a cast
// expression, so the obvious `"pirkimoNumeris" = ANY ($subjects)` left the
// planner scanning all 2.6 GB of that table — ~15 s, and ~62 s when the run
// is unscoped. Naming the CVP IS branch's own integer key instead (see
// v_pirkimas_v2.sql's comment on "cvpisPirkimoId") lets this disjunction be
// pushed into both UNION ALL branches, where the half that does not address a
// branch folds to a constant there and the other half becomes a real index
// condition on viesiejiPirkimai_pirkimoId_key / the cvpp pirkimoNumeris
// index.
//
// `intParam` carries the numeric subset of the scope (procurementIdsToInts
// below), `textParam` the whole scope as the view spells it.
function pirkimasScopePredicate(intParam: string, textParam: string): string {
    return `("cvpisPirkimoId" = ANY (${intParam}::int[])
             OR (saltinis = 'cvpp' AND "pirkimoNumeris" = ANY (${textParam}::text[])))`;
}

// The run's subject universe as an ordered, deduplicated key list, loaded
// once. Two things depend on it: which (saltinis, pirkimoNumeris) pairs each
// page covers, and — as the set of their pirkimoNumeris values — whether a
// lot is an orphan (see ensureLotUniverseLoaded below).
//
// DISTINCT guards against a duplicate notice on the cvpp side:
// cvppViesiejiPirkimai is keyed by skelbimoKodas, not pirkimoNumeris, so
// nothing stops two announcements naming the same pirkimoNumeris from both
// surviving the view's UNION ALL. ORDER BY here, not in JavaScript, so the
// page order stays the database's own collation order for these two columns.
const PROCUREMENT_KEYS_SQL = `
    ${publicViewsCte(["v_pirkimas_v2"])}
    SELECT DISTINCT saltinis, "pirkimoNumeris"
    FROM v_pirkimas_v2
    WHERE ($2::text[] IS NULL OR ${pirkimasScopePredicate("$1", "$2")})
    ORDER BY saltinis, "pirkimoNumeris"
`;

// One page's procurement rows, fetched by the keys PROCUREMENT_KEYS_SQL
// already settled on rather than by re-deriving the page from the whole
// universe. The query this replaced paged with a keyset predicate over
// v_pirkimas_v2 directly, which meant its `ORDER BY ... LIMIT` had to sort
// all ~265k rows of the view on every page — 38 MB spilled to disk and ~8.7 GB
// of I/O per page, work that grew with the population rather than with the
// page, making a full run quadratic. Here the sort input is one page.
//
// DISTINCT ON collapses the duplicate-cvpp-notice case DISTINCT handles in the
// keys query, keeping the most recently published of any such pair. Both
// duplicates always land in the same page, since a page is a set of
// (saltinis, pirkimoNumeris) keys.
const PROCUREMENT_PAGE_SQL = `
    ${publicViewsCte(["v_pirkimas_v2"])}
    SELECT DISTINCT ON (saltinis, "pirkimoNumeris")
           saltinis, "pirkimoNumeris", pavadinimas, "jarKodas", "pirkimoBudas", statusas,
           "pirkimoObjektoTipas", "numatomaVerteEUR", "paskelbimoData", "pasiulymuPateikimoTerminas",
           "bvpzKodai", "esFinansavimas"
    FROM v_pirkimas_v2
    WHERE ${pirkimasScopePredicate("$1", "$2")}
    ORDER BY saltinis, "pirkimoNumeris", "paskelbimoData" DESC NULLS LAST
`;

const LOT_SQL = `
    ${publicViewsCte(["v_pirkimo_dalis_v2"])}
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
    ${publicViewsCte(["v_dalyviai_v2"])}
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
    ${publicViewsCte(["v_dalyviai_v2"])}
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
//
// The last two ORDER BY terms are the tie-break, and they are load-bearing:
// without them the ranking above leaves genuinely tied duplicates — same
// bidder, same lot, same ataskaitosData, both carrying an outcome, but
// different eileNumeris and pasiulymoKaina — to be broken by whatever order
// the plan happened to produce, so a bid's price and rank could change from
// run to run with no change in the data. That case is real and not rare: a
// multi-lot report whose daliesNumeris never parsed contributes every lot's
// ranking row under the '0' fallback. Preferring the best rank, then the
// lowest price, makes the choice deterministic and states it.
const LOT_BIDS_SQL = `
    ${publicViewsCte(["v_dalyviai_v2"])}
    SELECT DISTINCT ON (d."pirkimoNumeris", COALESCE(d."daliesNumeris", '0'), d."tiekejoKodas")
           d."pirkimoNumeris"                                                          AS "pirkimoNumeris",
           COALESCE(d."daliesNumeris", '0')                                            AS "daliesNumeris",
           d."tiekejoKodas"                                                            AS "tiekejoKodas",
           d."eileNumeris"                                                             AS "eileNumeris",
           d."pasiulymoKaina"                                                          AS "pasiulymoKaina",
           d."atmetimoPriezastis"                                                      AS "atmetimoPriezastis",
           d."atmetimoStatusas"                                                        AS "atmetimoStatusas",
           d."atmetimoTeisinisPagrindas"                                               AS "atmetimoTeisinisPagrindas",
           to_char(d."ataskaitosData" AT TIME ZONE 'UTC',
                   'YYYY-MM-DD"T"HH24:MI:SS"Z"')                                        AS "reportedAt"
    FROM v_dalyviai_v2 d
    WHERE d."ataskaitosData" <= $1::timestamptz
      AND d."tiekejoKodas" IS NOT NULL
      AND ($2::text[] IS NULL OR d."pirkimoNumeris" = ANY ($2::text[]))
    ORDER BY d."pirkimoNumeris", COALESCE(d."daliesNumeris", '0'), d."tiekejoKodas",
             (d."eileNumeris" IS NOT NULL OR d."atmetimoStatusas" IS NOT NULL OR d."atmetimoPriezastis" IS NOT NULL) DESC,
             d."ataskaitosData" DESC,
             d."eileNumeris" ASC NULLS LAST,
             d."pasiulymoKaina" ASC NULLS LAST
`;

// Procurement-grain procedure-ending outcomes — every distinct
// "proceduruPabaiga" label observed across the procurement's lots, shared by
// every procurement-grain indicator that judges the procedure's outcome
// (currently LT-OTH-05). array_agg(DISTINCT ...) collapses repeated labels
// across lots (and across the rare duplicate report) to the set an
// indicator actually needs to test membership against.
//
// "lots" carries the same rows at their natural per-lot grain instead —
// (daliesNumeris, proceduruPabaiga, sprendimoPriemimoData, sprendimoPriezastys)
// tuples, exactly one per lot — for LT-OTH-03 and LT-OTH-04, which need a
// lot's own decision date paired with its own outcome label rather than the
// collapsed cross-lot set proceduruPabaigos/reportedAt provide, and for
// LT-TRA-06, which needs a lot's own stated reason text. json_agg is never
// null here: the JOIN in v_pirkimo_pabaiga_v2 guarantees at least one row
// per group.
//
// One per lot, not one per row: v_pirkimo_pabaiga_v2's own header calls its
// grain "(pirkimoNumeris, daliesNumeris)", but a procurement can carry more
// than one ATN-1 report (445 do; one carries 14), and the view emits every
// revision's row, so its real grain is (report, lot) — 12,275 rows for
// 10,841 lots warehouse-wide. Aggregating those raw made a two-lot
// procurement arrive with 34 entries in "lots" (cvpis:7213562), which
// LT-TRA-06 read as 34 lots to check for a documented reason — so a
// superseded revision that left the reason blank flagged a procurement whose
// current revision documents it — and which LT-OTH-03/LT-OTH-04 wrote into
// their rawValue.periods as a lot's evaluation period repeated once per
// revision. The window below keeps only each lot's most recent revision,
// which is what the three indicators mean by "this lot's outcome" and what
// the view's header already claims; ties inside one report are broken
// deterministically so a re-run reproduces the same row.
//
// Deliberately not applied to proceduruPabaigos or to the bool_or'd
// procurement-level flags below: those aggregate across every revision on
// purpose (see their own note), and narrowing them to the latest revision
// would change what they mean.
//
// preliminariSutartis (LT-PRI-06), pretenzijaPateikta (LT-TRA-07),
// ieskinysTeismui (LT-TRA-08), and elektroninisPirkimas (LT-TRA-09) are all
// xlsxPPAataskaitos fields carried straight through unrenamed,
// each bool_or'd across every lot and every report revision under this
// pirkimoNumeris: true if any revision ever said so, false if every revision
// said no, null if no revision ever populated the field (bool_or ignores
// NULL inputs, matching that semantics exactly).
const PROCEDURE_OUTCOME_SQL = `
    ${publicViewsCte(["v_pirkimo_pabaiga_v2"])},
    pabaiga AS (
        SELECT po.*,
               row_number() OVER (
                   PARTITION BY po."pirkimoNumeris", po."daliesNumeris"
                   ORDER BY po."ataskaitosData" DESC,
                            po."sprendimoPriemimoData" DESC NULLS LAST,
                            po."proceduruPabaiga",
                            po."sprendimoPriezastys" NULLS LAST
               ) AS "revisionRank"
        FROM v_pirkimo_pabaiga_v2 po
        WHERE po."ataskaitosData" <= $1::timestamptz
          AND ($2::text[] IS NULL OR po."pirkimoNumeris" = ANY ($2::text[]))
    )
    SELECT po."pirkimoNumeris"                                                            AS "pirkimoNumeris",
           array_agg(DISTINCT po."proceduruPabaiga")                                       AS "proceduruPabaigos",
           json_agg(json_build_object(
               'daliesNumeris', po."daliesNumeris",
               'proceduruPabaiga', po."proceduruPabaiga",
               'sprendimoPriemimoData', to_char(po."sprendimoPriemimoData", 'YYYY-MM-DD'),
               'sprendimoPriezastys', po."sprendimoPriezastys"
           ) ORDER BY po."daliesNumeris") FILTER (WHERE po."revisionRank" = 1)              AS "lots",
           to_char(max(po."sprendimoPriemimoData"), 'YYYY-MM-DD')                          AS "reportedAt",
           bool_or(po."preliminariSutartis")                                               AS "preliminariSutartis",
           bool_or(po."pretenzijaPateikta")                                                AS "pretenzijaPateikta",
           bool_or(po."ieskinysTeismui")                                                   AS "ieskinysTeismui",
           bool_or(po."elektroninisPirkimas")                                              AS "elektroninisPirkimas"
    FROM pabaiga po
    GROUP BY po."pirkimoNumeris"
`;

// Procurement-grain contract signature dates — every distinct "sudarymoData"
// observed across the procurement's own contracts (matched by pirkimoNumeris,
// v_pirkimo_sutartys_v2 already restricts to non-deleted, dated, plausibly-
// numeric pirkimoNumeris rows), shared by LT-OTH-04. array_agg(DISTINCT ...)
// collapses repeated dates (e.g. two lots of one procurement signed the same
// day) to the set an indicator actually pairs against; the JOIN in
// v_pirkimo_sutartys_v2 guarantees at least one row per group, so json_agg
// is never null here.
const CONTRACT_SIGNATURES_SQL = `
    ${publicViewsCte(["v_pirkimo_sutartys_v2"])}
    SELECT cs."pirkimoNumeris"                                             AS "pirkimoNumeris",
           array_agg(DISTINCT to_char(cs."sudarymoData", 'YYYY-MM-DD'))    AS "signatureDates"
    FROM v_pirkimo_sutartys_v2 cs
    WHERE ($1::text[] IS NULL OR cs."pirkimoNumeris" = ANY ($1::text[]))
    GROUP BY cs."pirkimoNumeris"
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
type ContractSignaturesRow = Readonly<{ pirkimoNumeris: string; signatureDates: readonly string[] }>;
type ProcurementKey = Readonly<{ saltinis: string; pirkimoNumeris: string }>;

function encodeCursor(saltinis: string, pirkimoNumeris: string): string {
    return `${saltinis}\u0000${pirkimoNumeris}`;
}

/**
 * The subset of a pirkimoNumeris scope that could name a CVP IS procurement,
 * as the int4 values viesiejiPirkimai."pirkimoId" is indexed on. A value that
 * is not a positive int4 is dropped rather than passed through: it could never
 * have equalled a "pirkimoId"::text either, so dropping it changes no result —
 * only how much Postgres has to look at. Anything dropped here is still
 * carried by the text half of pirkimasScopePredicate, which is what the CVPP
 * branch matches on.
 */
function procurementIdsToInts(pirkimoNumeriai: readonly string[]): number[] {
    const ids: number[] = [];
    for (const pirkimoNumeris of pirkimoNumeriai) {
        if (!/^[1-9][0-9]{0,9}$/.test(pirkimoNumeris)) continue;
        const id = Number(pirkimoNumeris);
        if (id <= 2147483647) ids.push(id);
    }
    return ids;
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
    private procurementKeys: readonly ProcurementKey[] | null = null;
    private keyIndexByCursor: Map<string, number> | null = null;
    private lotsByNumber: Map<string, Lot[]> | null = null;
    private procurementParticipationByNumber: Map<string, ProcurementParticipation> | null = null;
    private procedureOutcomeByNumber: Map<string, ProcurementProcedureOutcome> | null = null;
    private contractSignatureDatesByNumber: Map<string, readonly string[]> | null = null;
    private orphanLotCount = 0;
    private pageNumber = 0;

    constructor(data: RiskDataSource, subjects: readonly string[] | null, dataAsOf: string) {
        this.data = data;
        this.subjects = subjects;
        this.dataAsOf = dataAsOf;
    }

    /**
     * Runs one query and logs how long it took, so a slow query in the
     * ensureLotUniverseLoaded() Promise.all can be told from the rest — the
     * batch's own total says only how long the slowest one took. Timings are
     * per-query wall clock; because the batch runs concurrently they overlap
     * and will not sum to the batch total.
     */
    private async timedQuery<T>(label: string, sqlText: string, params: readonly unknown[]): Promise<readonly T[]> {
        const startedAt = Date.now();
        const rows = await this.data.query<T>(sqlText, params);
        const timeSpent = Date.now() - startedAt;
        const timeSpentLabel =  `${timeSpent}ms`.padEnd(10);
        const rowsLabel = `${rows.length} rows`.padEnd(16);
        // Blank rather than "Infinity" for an empty result: a per-row cost is
        // meaningless there, and the unit is ms, which the old "s/r" suffix
        // misstated by three orders of magnitude.
        const perRow = rows.length === 0 ? "" : `${Math.round(timeSpent / rows.length)}ms/row`;
        log(`procurementReader: ${label.padEnd(32)} ${timeSpentLabel} ${rowsLabel} ${perRow}`);
        return rows;
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

    /**
     * One page of the universe. The cursor is still an opaque
     * `saltinis pirkimoNumeris` string and still means "resume after this
     * key", but it now indexes into the key list loaded once per run rather
     * than seeding a keyset predicate over v_pirkimas_v2 — see
     * PROCUREMENT_PAGE_SQL on why that predicate could not stay.
     */
    async loadProcurements(cursor: string | null, pageSize: number): Promise<Page<Procurement>> {
        await this.ensureLotUniverseLoaded();

        this.pageNumber++;
        const startedAt = Date.now();

        const keys = this.procurementKeys!;
        // A cursor names the last key of the page before this one. Keys are in
        // the database's own ordering of (saltinis, pirkimoNumeris) — see
        // PROCUREMENT_KEYS_SQL — so resuming is a lookup, not a comparison.
        // An unknown cursor is rejected rather than tolerated: silently
        // treating it as "start over" would loop the run forever.
        const resumeAfter = cursor === null ? -1 : this.keyIndexByCursor!.get(cursor) ?? null;
        if (resumeAfter === null) {
            throw new Error(`procurementReader: cursor names no procurement in this run's universe`);
        }
        const from = resumeAfter + 1;
        const pageKeys = keys.slice(from, from + pageSize);

        const rows =
            pageKeys.length === 0
                ? []
                : await this.data.query<
                      Omit<Procurement, "lots" | "participation" | "procedureOutcome" | "contractSignatureDates">
                  >(PROCUREMENT_PAGE_SQL, [
                      procurementIdsToInts(
                          pageKeys.filter((key) => key.saltinis === "cvpis").map((key) => key.pirkimoNumeris),
                      ),
                      pageKeys.filter((key) => key.saltinis === "cvpp").map((key) => key.pirkimoNumeris),
                  ]);

        const items: Procurement[] = rows.map((row) => ({
            ...row,
            lots: this.lotsByNumber!.get(row.pirkimoNumeris) ?? [],
            participation: this.procurementParticipationByNumber!.get(row.pirkimoNumeris) ?? null,
            procedureOutcome: this.procedureOutcomeByNumber!.get(row.pirkimoNumeris) ?? null,
            contractSignatureDates: this.contractSignatureDatesByNumber!.get(row.pirkimoNumeris) ?? null,
        }));

        // Taken from the key list rather than from the rows: the two agree on
        // every key that still resolves, and taking it from the keys keeps
        // paging advancing even if a row vanished between the key load and
        // this fetch.
        const lastKey = pageKeys[pageKeys.length - 1];
        const nextCursor =
            from + pageKeys.length < keys.length && lastKey
                ? encodeCursor(lastKey.saltinis, lastKey.pirkimoNumeris)
                : null;

        log(
            `procurementReader: page ${this.pageNumber} loaded ${rows.length} procurement(s) in ${Date.now() - startedAt}ms` +
                (nextCursor ? " (more pages pending)" : " (last page)"),
        );

        return { items, nextCursor };
    }

    /**
     * Runs the key list, LOT_SQL and both participation queries exactly once
     * per instance, scoped by the same subjects/dataAsOf every page shares,
     * and caches the merged result. A page-scoped lot query (bound to only
     * that page's pirkimoNumeris values) could never observe a mismatch
     * against the procurement key list, so orphan-lot detection needs the full
     * universe up front, not a per-page slice.
     */
    private async ensureLotUniverseLoaded(): Promise<void> {
        if (this.lotsByNumber !== null) return;

        log("procurementReader: loading lot universe (procurement keys, lots, participation, bids, procedure outcomes, contract signatures)...");
        const startedAt = Date.now();

        const [procurementKeys, lotRows, lotParticipationRows, procurementParticipationRows, bidRows, procedureOutcomeRows, contractSignatureRows] =
            await Promise.all([
                this.timedQuery<ProcurementKey>("PROCUREMENT_KEYS_SQL", PROCUREMENT_KEYS_SQL, [
                    this.subjects === null ? null : procurementIdsToInts(this.subjects),
                    this.subjects,
                ]),
                this.timedQuery<LotRow>("LOT_SQL", LOT_SQL, [this.subjects]),
                this.timedQuery<LotParticipationRow>("LOT_PARTICIPATION_SQL", LOT_PARTICIPATION_SQL, [this.dataAsOf, this.subjects]),
                this.timedQuery<ProcurementParticipationRow>("PROCUREMENT_PARTICIPATION_SQL", PROCUREMENT_PARTICIPATION_SQL, [
                    this.dataAsOf,
                    this.subjects,
                ]),
                this.timedQuery<BidRow>("LOT_BIDS_SQL", LOT_BIDS_SQL, [this.dataAsOf, this.subjects]),
                this.timedQuery<ProcedureOutcomeRow>("PROCEDURE_OUTCOME_SQL", PROCEDURE_OUTCOME_SQL, [this.dataAsOf, this.subjects]),
                this.timedQuery<ContractSignaturesRow>("CONTRACT_SIGNATURES_SQL", CONTRACT_SIGNATURES_SQL, [this.subjects]),
            ]);

        this.procurementKeys = procurementKeys;
        this.keyIndexByCursor = new Map(
            procurementKeys.map((key, index) => [encodeCursor(key.saltinis, key.pirkimoNumeris), index]),
        );
        const validIds = new Set(procurementKeys.map((key) => key.pirkimoNumeris));

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
                atmetimoTeisinisPagrindas: row.atmetimoTeisinisPagrindas,
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
        log(
            `procurementReader: lot universe loaded in ${Date.now() - startedAt}ms ` +
                `(${lotRows.length} lot(s), ${bidRows.length} bid(s))`,
        );

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
                {
                    proceduruPabaigos: row.proceduruPabaigos,
                    lots: row.lots,
                    reportedAt: row.reportedAt,
                    preliminariSutartis: row.preliminariSutartis,
                    pretenzijaPateikta: row.pretenzijaPateikta,
                    ieskinysTeismui: row.ieskinysTeismui,
                    elektroninisPirkimas: row.elektroninisPirkimas,
                },
            ]),
        );
        this.contractSignatureDatesByNumber = new Map(
            contractSignatureRows.map((row) => [row.pirkimoNumeris, row.signatureDates]),
        );
    }
}
