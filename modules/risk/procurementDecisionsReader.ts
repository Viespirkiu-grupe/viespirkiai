import { riskDb } from "../../postgres/riskDb.js";
import { log } from "../../utils/log.js";
import type { RiskSignal, SubjectType } from "./types.ts";
import { riskCatalogue } from "./deployedIndicators.ts";

// Reads risk.risk_procurement_decisions for display on the procurement
// detail page (src/pages/viesiejiPirkimai/[id].astro). No existing module
// read this table back before — services/procurement-risk/write.ts and the
// integration tests are the only other callers. See
// docs/indicators-story/risk-service-architecture.md §2.4.

export type EnrichedRiskSignal = RiskSignal &
    Readonly<{
        titleLt: string;
        descriptionLt: string;
        formulaLt: string;
        limitationLt: string;
    }>;

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

function enrich(signal: RiskSignal): EnrichedRiskSignal {
    const entry = catalogueByKey.get(`${signal.indicatorId}/${signal.indicatorVersion}`);
    return {
        ...signal,
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
    let row: { signals: RiskSignal[]; data_as_of: unknown } | undefined;
    try {
        const { rows } = await riskDb.query(
            `SELECT signals, data_as_of FROM risk.risk_procurement_decisions
              WHERE procurement_source = $1 AND procurement_id = $2`,
            [procurementSource, procurementId],
        );
        row = rows[0];
    } catch (err) {
        // The risk DB is a separate Postgres instance (postgres/riskDb.js) that
        // isn't guaranteed to be up in every dev environment — never let a
        // down/misconfigured risk DB break the procurement page.
        log(`rizikos signalų nepavyko nuskaityti (${procurementSource}:${procurementId}): ${(err as Error)?.message ?? err}`);
        return null;
    }
    if (!row) return null;

    const triggered = row.signals.filter((s) => s.state === "triggered").map(enrich);
    const bySubjectType = (subjectType: SubjectType) => triggered.filter((s) => s.subjectType === subjectType);

    const lots = bySubjectType("lot");
    const bids = bySubjectType("bid");

    const dataAsOf = row.data_as_of instanceof Date ? row.data_as_of.toISOString() : String(row.data_as_of);

    return {
        procurement: bySubjectType("procurement"),
        lotsByDalis: groupBy(lots, (s) => stripSubjectPrefix(s.subjectKey, procurementSource, procurementId)),
        bidsByDalisAndTiekejas: groupBy(bids, (s) => stripSubjectPrefix(s.subjectKey, procurementSource, procurementId)),
        dataAsOf,
    };
}
