import type { ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltOth03Definition } from "./definition.ts";

// LT-OTH-03 — Evaluation/decision period anomalously short or long: judges a
// whole procurement from the per-lot procedure-ending outcomes and decision
// dates the Procurement Reader already merged onto
// Subject.procurement.procedureOutcome.lots, paired against the
// procurement's own pasiulymuPateikimoTerminas. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4 and
// modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql.

// Extracts the calendar date (UTC, time-of-day discarded) a Postgres
// date/timestamp column serializes to as its leading 10 characters —
// "2026-04-21" whether the source was `date` (to_char'd to exactly that) or
// `timestamp without time zone` (space- or "T"-separated, with or without a
// time part). Never uses Date.parse on the full string: its behaviour on a
// non-"Z"-suffixed, space-separated timestamp string is locale/engine
// dependent, exactly the ambiguity a risk indicator's own threshold must
// not inherit.
function dateOnlyEpochDays(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

type LotPeriod = Readonly<{ daliesNumeris: string; periodDays: number }>;

export class LtOth03Decision extends AProcurementIndicatorDecision<typeof ltOth03Definition> {
    static readonly definition = ltOth03Definition;
    protected readonly missingDataWhenAbsent = ["sprendimoPriemimoData", "pasiulymuPateikimoTerminas"];

    constructor(context: EvaluationContext) {
        super(ltOth03Definition, context);
    }

    // Every concluded lot's evaluation period, in days — sprendimoPriemimoData
    // minus the procurement's own pasiulymuPateikimoTerminas. Only a lot
    // whose ATN-1 outcome is one of concludedOutcomes is included: for any
    // other outcome (terminated, all rejected, no bids), the decision date
    // is not reliably "the day evaluation of submitted tenders finished" —
    // see definition.ts's limitationLt — so it is excluded here rather than
    // measured. A lot is also excluded if either date fails to parse as a
    // calendar date, which never happens against real data (the reader
    // always to_char's sprendimoPriemimoData, and Postgres always emits a
    // date/timestamp's calendar date as its leading 10 characters) but keeps
    // hasRequiredData and assessRisk agreeing on exactly the same set of
    // usable lots regardless.
    private evaluationPeriods(procurement: ProcurementSubject["procurement"]): readonly LotPeriod[] {
        if (procurement.pasiulymuPateikimoTerminas === null || procurement.procedureOutcome === null) return [];

        const deadlineDays = dateOnlyEpochDays(procurement.pasiulymuPateikimoTerminas);
        if (deadlineDays === null) return [];

        const { concludedOutcomes } = this.definition.parameters;
        const periods: LotPeriod[] = [];
        for (const lot of procurement.procedureOutcome.lots) {
            if (!concludedOutcomes.includes(lot.proceduruPabaiga) || lot.sprendimoPriemimoData === null) continue;
            const decisionDays = dateOnlyEpochDays(lot.sprendimoPriemimoData);
            if (decisionDays === null) continue;
            periods.push({ daliesNumeris: lot.daliesNumeris, periodDays: decisionDays - deadlineDays });
        }
        return periods;
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        return this.evaluationPeriods(subject.procurement).length > 0;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        const { minimumDays, maximumDays } = this.definition.parameters;
        // hasRequiredData already proved this is non-empty.
        const periods = this.evaluationPeriods(subject.procurement);

        const anomalous = periods.some((p) => p.periodDays < minimumDays || p.periodDays > maximumDays);
        return this.signalFor(subject, {
            state: anomalous ? "triggered" : "not_triggered",
            rawValue: { periods },
            threshold: { minimumDays, maximumDays },
            appliedParameters: { minimumDays, maximumDays },
        });
    }
}
