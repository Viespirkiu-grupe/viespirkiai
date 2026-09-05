import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import type { RiskSignal, SubjectType } from "./types.ts";
import { riskCatalogue } from "./deployedIndicators.ts";
import { riskProcurementSource } from "./riskCodes.ts";

// Reads risk."procurementDecisions" joined to risk."signals" for
// display on the procurement detail page
// (src/pages/viesiejiPirkimai/[id].astro). No existing module read these
// tables back before — services/procurement-risk/write.ts and the
// integration tests are the only other callers. See
// docs/indicators-story/risk-service-architecture.md §2.4.

// dataAsOf isn't part of the persisted RiskSignal (it lives once on the
// parent decisions row, §2.4) — the reader stamps it back on for display,
// since the GUI shows it per chip.
export type EnrichedRiskSignal = RiskSignal &
    Readonly<{
        dataAsOf: string;
        titleLt: string;
        descriptionLt: string;
        formulaLt: string;
        limitationLt: string;
    }>;

// The query below resolves every lookup id back to its code, so a row is
// already a RiskSignal — except for "missingData", which the narrow schema
// stores as NULL rather than an empty array
// (migrations/risk/002_riskNarrow.sql §4).
//
// "subjectKey" arrives prefixless: '' for a procurement, '<dalis>' for a lot,
// '<dalis>:<tiekejoKodas>' for a bid. That is exactly the key this module
// groups by, so nothing needs stripping any more.
type RiskSignalRow = Readonly<Omit<RiskSignal, "missingData"> & { missingData: readonly string[] | null }>;

function rowToSignal(row: RiskSignalRow): RiskSignal {
    return { ...row, missingData: row.missingData ?? [] };
}

export type ProcurementRiskView = Readonly<{
    // subjectType === "procurement", state === "triggered".
    procurement: readonly EnrichedRiskSignal[];
    // subjectType === "lot", state === "triggered", keyed by daliesNumeris
    // (the '0' fallback v_pirkimo_dalis_v2.sql uses for a missing lot number).
    lotsByDalis: ReadonlyMap<string, readonly EnrichedRiskSignal[]>;
    // subjectType === "bid", state === "triggered", keyed by
    // `${daliesNumeris}:${tiekejoKodas}`.
    bidsByDalisAndTiekejas: ReadonlyMap<string, readonly EnrichedRiskSignal[]>;
    dataAsOf: string;
}>;

// riskCatalogue only lists currently-deployed indicators; a stored signal
// can reference an older/retired (id, version) that fell out of it. Falling
// back to the indicatorId keeps such a signal visible instead of dropping it
// or throwing (unlike RiskIndicatorRegistry.require, which throws).
const catalogueByKey = new Map(riskCatalogue.map((entry) => [`${entry.id}/${entry.version}`, entry]));

function enrich(signal: RiskSignal, dataAsOf: string): EnrichedRiskSignal {
    const entry = catalogueByKey.get(`${signal.indicatorId}/${signal.indicatorVersion}`);
    return {
        ...signal,
        dataAsOf,
        titleLt: entry?.public.titleLt ?? signal.indicatorId,
        descriptionLt: entry?.public.descriptionLt ?? "",
        formulaLt: entry?.public.formulaLt ?? "",
        limitationLt: entry?.public.limitationLt ?? "",
    };
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): ReadonlyMap<string, readonly T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) {
        const key = keyOf(item);
        const bucket = map.get(key);
        if (bucket) bucket.push(item);
        else map.set(key, [item]);
    }
    return map;
}

export async function loadProcurementRiskView(
    procurementSource: string,
    procurementId: string,
): Promise<ProcurementRiskView | null> {
    let decisionRow: { id: number; dataAsOf: unknown } | undefined;
    let signalRows: readonly RiskSignalRow[] = [];
    try {
        const { rows } = await postgres.query<{ id: number; dataAsOf: unknown }>(
            `SELECT d."id", d."dataAsOf"
               FROM risk."procurementDecisions" d
                        JOIN risk."procurementSources" ps ON ps."id" = d."source"
              WHERE ps."code" = $1 AND d."procurementId" = $2`,
            [riskProcurementSource(procurementSource), procurementId],
        );
        decisionRow = rows[0];
        if (decisionRow) {
            // Every narrow column is joined back to its lookup code here, so
            // the shape this module returns is unchanged from the wide schema.
            const signals = await postgres.query<RiskSignalRow>(
                `SELECT i."code"     AS "indicatorId",
                        i."version"  AS "indicatorVersion",
                        sub."code"   AS "subjectType",
                        s."subjectKey",
                        st."code"    AS "state",
                        s."rawValue",
                        p."threshold",
                        p."appliedParameters",
                        (SELECT array_agg(mf."code" ORDER BY u.ord)
                           FROM unnest(s."missingData") WITH ORDINALITY AS u(id, ord)
                                    JOIN risk."missingFields" mf ON mf."id" = u.id) AS "missingData"
                   FROM risk."signals" s
                            JOIN risk."signalStates" st ON st."id" = s."state"
                            JOIN risk."indicators" i ON i."id" = s."indicator"
                            JOIN risk."subjectTypes" sub ON sub."id" = i."subjectType"
                            LEFT JOIN risk."parameterSets" p ON p."id" = s."parameterSet"
                  WHERE s."decisionId" = $1 AND st."code" = 'triggered'`,
                [decisionRow.id],
            );
            signalRows = signals.rows;
        }
    } catch (err) {
        // The `risk` schema isn't guaranteed to exist in every dev environment
        // (migrations/risk/001_risk.sql may not have been applied) — never let
        // a missing or misconfigured risk schema break the procurement page.
        log(`rizikos signalų nepavyko nuskaityti (${procurementSource}:${procurementId}): ${(err as Error)?.message ?? err}`);
        return null;
    }
    if (!decisionRow) return null;

    const dataAsOf = decisionRow.dataAsOf instanceof Date ? decisionRow.dataAsOf.toISOString() : String(decisionRow.dataAsOf);

    const triggered = signalRows.map((row) => enrich(rowToSignal(row), dataAsOf));
    const bySubjectType = (subjectType: SubjectType) => triggered.filter((s) => s.subjectType === subjectType);

    const lots = bySubjectType("lot");
    const bids = bySubjectType("bid");

    return {
        procurement: bySubjectType("procurement"),
        lotsByDalis: groupBy(lots, (s) => s.subjectKey),
        bidsByDalisAndTiekejas: groupBy(bids, (s) => s.subjectKey),
        dataAsOf,
    };
}
