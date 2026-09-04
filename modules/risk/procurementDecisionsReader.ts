import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import type { RiskSignal, SubjectType } from "./types.ts";
import { riskCatalogue } from "./deployedIndicators.ts";

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

// risk."signals" columns are camelCase, so a row is already a RiskSignal —
// except for "missingData", which the column allows NULL for.
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

// Strips the `${procurementSource}:${procurementId}:` prefix every lot/bid
// subjectKey carries (see types.ts's Lot.subjektoRaktas / riskDecisionEngine.ts's
// subjectKey construction), leaving `daliesNumeris` (lot) or
// `daliesNumeris:tiekejoKodas` (bid).
function stripSubjectPrefix(subjectKey: string, procurementSource: string, procurementId: string): string {
    const prefix = `${procurementSource}:${procurementId}:`;
    return subjectKey.startsWith(prefix) ? subjectKey.slice(prefix.length) : subjectKey;
}

export async function loadProcurementRiskView(
    procurementSource: string,
    procurementId: string,
): Promise<ProcurementRiskView | null> {
    let decisionRow: { id: string; dataAsOf: unknown } | undefined;
    let signalRows: readonly RiskSignalRow[] = [];
    try {
        const { rows } = await postgres.query<{ id: string; dataAsOf: unknown }>(
            `SELECT "id", "dataAsOf" FROM risk."procurementDecisions"
              WHERE "procurementSource" = $1 AND "procurementId" = $2`,
            [procurementSource, procurementId],
        );
        decisionRow = rows[0];
        if (decisionRow) {
            const signals = await postgres.query<RiskSignalRow>(
                `SELECT "indicatorId", "indicatorVersion", "subjectType", "subjectKey", "state",
                        "rawValue", "threshold", "appliedParameters", "missingData"
                   FROM risk."signals"
                  WHERE "decisionId" = $1 AND "state" = 'triggered'`,
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
        lotsByDalis: groupBy(lots, (s) => stripSubjectPrefix(s.subjectKey, procurementSource, procurementId)),
        bidsByDalisAndTiekejas: groupBy(bids, (s) => stripSubjectPrefix(s.subjectKey, procurementSource, procurementId)),
        dataAsOf,
    };
}
