import { riskDb } from "../../postgres/riskDb.js";
import { log } from "../../utils/log.js";
import type { RiskSignal, SubjectType } from "./types.ts";
import { riskCatalogue } from "./deployedIndicators.ts";

// Reads risk.risk_procurement_decisions joined to risk.risk_signals for
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

type RiskSignalRow = Readonly<{
    indicator_id: string;
    indicator_version: number;
    subject_type: SubjectType;
    subject_key: string;
    state: RiskSignal["state"];
    raw_value: Readonly<Record<string, unknown>> | null;
    threshold: Readonly<Record<string, unknown>> | null;
    applied_parameters: Readonly<Record<string, unknown>> | null;
    missing_data: readonly string[] | null;
}>;

function rowToSignal(row: RiskSignalRow): RiskSignal {
    return {
        indicatorId: row.indicator_id,
        indicatorVersion: row.indicator_version,
        subjectType: row.subject_type,
        subjectKey: row.subject_key,
        state: row.state,
        rawValue: row.raw_value,
        threshold: row.threshold,
        appliedParameters: row.applied_parameters,
        missingData: row.missing_data ?? [],
    };
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
    let decisionRow: { id: string; data_as_of: unknown } | undefined;
    let signalRows: readonly RiskSignalRow[] = [];
    try {
        const { rows } = await riskDb.query<{ id: string; data_as_of: unknown }>(
            `SELECT id, data_as_of FROM risk.risk_procurement_decisions
              WHERE procurement_source = $1 AND procurement_id = $2`,
            [procurementSource, procurementId],
        );
        decisionRow = rows[0];
        if (decisionRow) {
            const signals = await riskDb.query<RiskSignalRow>(
                `SELECT indicator_id, indicator_version, subject_type, subject_key, state,
                        raw_value, threshold, applied_parameters, missing_data
                   FROM risk.risk_signals
                  WHERE decision_id = $1 AND state = 'triggered'`,
                [decisionRow.id],
            );
            signalRows = signals.rows;
        }
    } catch (err) {
        // The risk DB is a separate Postgres instance (postgres/riskDb.js) that
        // isn't guaranteed to be up in every dev environment — never let a
        // down/misconfigured risk DB break the procurement page.
        log(`rizikos signalų nepavyko nuskaityti (${procurementSource}:${procurementId}): ${(err as Error)?.message ?? err}`);
        return null;
    }
    if (!decisionRow) return null;

    const dataAsOf = decisionRow.data_as_of instanceof Date ? decisionRow.data_as_of.toISOString() : String(decisionRow.data_as_of);

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
