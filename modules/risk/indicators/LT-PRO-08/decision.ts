import type { EligibilityOutcome, PartialRiskSignal, ProcurementSubject, RiskSignal } from "../../types.ts";
import { AProcurementIndicatorDecision } from "../../procurementLotDecision.ts";
import { procurementEligibility } from "../../procurementEligibility.ts";
import type { EvaluationContext } from "../../evaluationContext.ts";
import { ltPro08Definition } from "./definition.ts";

// LT-PRO-08 — Short submission/advertisement period: judges a whole
// procurement from its own paskelbimoData/pasiulymuPateikimoTerminas,
// already present on Subject.procurement (no reader change needed — see
// README.md). See docs/indicators-story/risk-service-architecture-v2.md
// §1.2/§3.4.

// Extracts the calendar date (UTC, time-of-day discarded) a Postgres
// date/timestamp column serializes to as its leading 10 characters — see
// LT-OTH-03/decision.ts's identical helper for why Date.parse on the full
// string is never used.
function dateOnlyEpochDays(value: string): number | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (!match) return null;
    return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000;
}

export class LtPro08Decision extends AProcurementIndicatorDecision<typeof ltPro08Definition> {
    static readonly definition = ltPro08Definition;
    protected readonly missingDataWhenAbsent = ["paskelbimoData", "pasiulymuPateikimoTerminas"];

    constructor(context: EvaluationContext) {
        super(ltPro08Definition, context);
    }

    // The procurement's own advertisement-to-submission period, in calendar
    // days: pasiulymuPateikimoTerminas minus paskelbimoData. null when
    // either date is missing, or when the computed value is not strictly
    // positive — a notice cannot genuinely set a submission deadline before
    // (or on the same calendar day as) its own publication, so a
    // non-positive value is a plausibility failure (real data shows it is
    // almost always a later notice event — e.g. a cancellation — republished
    // under the same pirkimoNumeris, carrying a newer paskelbimoData but the
    // original, now-stale pasiulymuPateikimoTerminas; see README.md's
    // measurement), not a genuine "even shorter than short" period. Excluded
    // here rather than counted, the same "exclude, don't force a bogus
    // interpretation" convention LT-OTH-04's awardToSignaturePeriods() uses
    // for a chronologically impossible pairing.
    private submissionPeriodDays(procurement: ProcurementSubject["procurement"]): number | null {
        const { paskelbimoData, pasiulymuPateikimoTerminas } = procurement;
        if (paskelbimoData === null || pasiulymuPateikimoTerminas === null) return null;

        const publishedDays = dateOnlyEpochDays(paskelbimoData);
        const deadlineDays = dateOnlyEpochDays(pasiulymuPateikimoTerminas);
        if (publishedDays === null || deadlineDays === null) return null;

        const periodDays = deadlineDays - publishedDays;
        return periodDays > 0 ? periodDays : null;
    }

    // Rinkos konsultacija (pre-procurement market consultation) is not a
    // competitive tender with a submission-of-tenders deadline — its own
    // response window is not an instance of the catalogue concept, so it is
    // gated to not_applicable before hasRequiredData is even asked (see
    // README.md's measurement: naively including it made up ~47% of the
    // naive triggered population). Every other eligible pirkimoBudas is left
    // alone, following LT-PRO-01/LT-PRO-05's "no further method-based
    // narrowing" convention.
    isEligible(subject: ProcurementSubject): EligibilityOutcome {
        if (subject.subjectType !== "procurement") {
            throw new Error(`${this.id}: expected a procurement subject, got ${subject.subjectType}`);
        }

        const gate = procurementEligibility(subject.procurement);
        if (!gate.eligible) {
            return { eligible: false, signal: this.signalFor(subject, gate.decision) };
        }

        const { excludedProcedures } = this.definition.parameters;
        if (excludedProcedures.includes(subject.procurement.pirkimoBudas!)) {
            return { eligible: false, signal: this.signalFor(subject, { state: "not_applicable" }) };
        }

        if (!this.hasRequiredData(subject)) {
            const partial: PartialRiskSignal = {
                state: "insufficient_data",
                missingData: [...this.missingDataWhenAbsent],
            };
            return { eligible: false, signal: this.signalFor(subject, partial) };
        }

        return { eligible: true };
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        return this.submissionPeriodDays(subject.procurement) !== null;
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        const { minimumDays } = this.definition.parameters;
        // hasRequiredData already proved this is non-null.
        const periodDays = this.submissionPeriodDays(subject.procurement)!;

        return this.signalFor(subject, {
            state: periodDays < minimumDays ? "triggered" : "not_triggered",
            rawValue: { periodDays },
            threshold: { minimumDays },
            appliedParameters: { minimumDays },
        });
    }
}
