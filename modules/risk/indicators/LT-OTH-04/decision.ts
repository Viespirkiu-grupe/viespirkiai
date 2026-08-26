import type { ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltOth04Definition } from "./definition.ts";

// LT-OTH-04 — Award-to-signature period unusually long: judges a whole
// procurement from the per-lot procedure-ending outcomes and decision dates
// the Procurement Reader already merged onto
// Subject.procurement.procedureOutcome.lots, paired against the
// procurement's own contractSignatureDates. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2/§3.4,
// modules/mcp/analyst/views/v_pirkimo_pabaiga_v2.sql and
// v_pirkimo_sutartys_v2.sql.

// Extracts the calendar date (UTC, time-of-day discarded) a Postgres
// date/timestamp column serializes to as its leading 10 characters — see
// LT-OTH-03/decision.ts's identical helper for why Date.parse on the full
// string is never used.
function dateOnlyEpochDays(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

type LotPeriod = Readonly<{ daliesNumeris: string; periodDays: number }>;

export class LtOth04Decision extends AProcurementIndicatorDecision<typeof ltOth04Definition> {
    static readonly definition = ltOth04Definition;
    protected readonly missingDataWhenAbsent = ["sprendimoPriemimoData", "sudarymoData"];

    constructor(context: EvaluationContext) {
        super(ltOth04Definition, context);
    }

    // Every concluded lot's award-to-signature period, in days — the
    // earliest of the procurement's own contract signature dates on or
    // after that lot's own sprendimoPriemimoData, minus
    // sprendimoPriemimoData. Only a lot whose ATN-1 outcome is one of
    // concludedOutcomes is included (same reasoning as LT-OTH-03's
    // evaluationPeriods). A contract signed before the decision date is
    // never picked: v_sutartys carries no daliesNumeris, so pirkimoNumeris
    // alone cannot say which contract belongs to which lot, and real data
    // shows a pirkimoNumeris match to a contract that predates its own
    // decision by years — almost certainly an unrelated contract that
    // happens to share the same (dirty or reused) pirkimoNumeris, not a
    // genuine same-day-or-earlier signature (see README.md's measurement).
    // "earliest on/after" is therefore the plausibility filter, not just a
    // tie-break: it is what keeps a negative period — logically impossible
    // for the real concept ("signed before being awarded") — from ever
    // being computed at all.
    private awardToSignaturePeriods(subject: ProcurementSubject): readonly LotPeriod[] {
        const { procurement } = subject;
        if (procurement.procedureOutcome === null || procurement.contractSignatureDates === null) return [];

        const signatureDays = procurement.contractSignatureDates
            .map(dateOnlyEpochDays)
            .filter((days): days is number => days !== null)
            .sort((a, b) => a - b);
        if (signatureDays.length === 0) return [];

        const { concludedOutcomes } = this.definition.parameters;
        const periods: LotPeriod[] = [];
        for (const lot of procurement.procedureOutcome.lots) {
            if (!concludedOutcomes.includes(lot.proceduruPabaiga) || lot.sprendimoPriemimoData === null) continue;
            const awardDays = dateOnlyEpochDays(lot.sprendimoPriemimoData);
            if (awardDays === null) continue;

            const nearestSignatureDays = signatureDays.find((days) => days >= awardDays);
            if (nearestSignatureDays === undefined) continue;

            periods.push({ daliesNumeris: lot.daliesNumeris, periodDays: nearestSignatureDays - awardDays });
        }
        return periods;
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        return this.awardToSignaturePeriods(subject).length > 0;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        const { maximumDays } = this.definition.parameters;
        // hasRequiredData already proved this is non-empty.
        const periods = this.awardToSignaturePeriods(subject);

        const anomalous = periods.some((p) => p.periodDays > maximumDays);
        return this.signalFor(subject, {
            state: anomalous ? "triggered" : "not_triggered",
            rawValue: { periods },
            threshold: { maximumDays },
            appliedParameters: { maximumDays },
        });
    }
}
