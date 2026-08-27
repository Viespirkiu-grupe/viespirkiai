// Every pure type in the Procurement Risk Service — no runtime behaviour.
// Runtime schemas/validators live in contracts.ts; behaviour lives in
// riskIndicatorDecision.ts, procurementLotDecision.ts, evaluationContext.ts,
// and riskDataSource.ts. See
// docs/indicators-story/risk-service-architecture-v2.md §3.4.

export type IndicatorStage = "planning" | "tender" | "award" | "contract";
export type SubjectType = "procurement" | "lot" | "bid" | "contract" | "supplier";

// The four states a calculation returns.
export type IndicatorState = "triggered" | "not_triggered" | "insufficient_data" | "not_applicable";

// The four IndicatorState values, plus "calculation_error".
export type SignalState = IndicatorState | "calculation_error";

export type RuntimeContract<T> = Readonly<{
    validate(value: unknown): T;
}>;

// Canonical catalogue identity, e.g. { id: 'LT-PRO-08', version: 2 }.
export type RiskIndicatorKey = Readonly<{
    id: `LT-${string}`;
    version: number;
}>;

// RiskSignal (risk-service-architecture.md §2.3), validated at runtime by
// contracts.ts's riskSignalSchema. Persisted as its own row in
// risk.risk_signals, linked to its procurement only via that row's
// decision_id (a surrogate FK, resolved by joining risk_procurement_decisions
// — never stamped onto the signal itself). Carries neither
// procurementSource/procurementId nor dataAsOf: both are held once on the
// parent ProcurementRiskDecisions/risk_procurement_decisions row instead.
export type RiskSignal = Readonly<{
    indicatorId: string;
    indicatorVersion: number;
    subjectType: SubjectType;
    subjectKey: string;
    state: IndicatorState;
    rawValue: Readonly<Record<string, unknown>> | null;
    threshold: Readonly<Record<string, unknown>> | null;
    appliedParameters: Readonly<Record<string, unknown>> | null;
    missingData: readonly string[];
}>;

// One procurement's whole risk picture (risk-service-architecture.md §2.3):
// every RiskSignal the run produced for it, its lots and its bids, collected
// by RiskDecisionEngine.evaluateAll (riskDecisionEngine.ts) and persisted by
// the Decision Writer as one row in risk.risk_procurement_decisions (metadata
// only), keyed by (procurementSource, procurementId), plus one row per signal
// in risk.risk_signals linked back via that row's id (decision_id). runId/
// dataAsOf describe the run that last refreshed the row; createdAt/updatedAt
// are best-effort placeholders here — the upsert SQL
// (services/procurement-risk/write.ts) is the actual authority on those two
// columns (DEFAULT now() on insert, now() on every refresh, created_at
// otherwise untouched).
export type ProcurementRiskDecisions = Readonly<{
    procurementSource: string;
    procurementId: string;
    runId: number;
    signals: readonly RiskSignal[];
    dataAsOf: string;
    createdAt: Date;
    updatedAt: Date;
}>;

export type RunStatus = "running" | "succeeded" | "partial" | "failed";

export type IndicatorStats = Readonly<{ rows: number; triggered: number; written: number }>;

// Run-wide counters (runJob.ts), alongside indicators' own per-indicator
// breakdown — the numbers an operator watching a run cares about without
// summing the per-indicator table by hand. procurementsEvaluated/
// decisionsWritten and signalsEvaluated/signalsWritten can differ from one
// another the same way an indicator's own rows/written can: a page whose
// write fails still evaluated its procurements/signals, but wrote none of
// them (the run then closes 'partial', not 'failed' — pagesFailed says how
// many pages that happened to).
export type RunTotals = Readonly<{
    procurementsEvaluated: number;
    decisionsWritten: number;
    signalsEvaluated: number;
    signalsTriggered: number;
    signalsWritten: number;
    orphanLotsDropped: number;
    pagesProcessed: number;
    pagesFailed: number;
    durationSec: number;
}>;

export type RunStatistics = Readonly<{
    totals: RunTotals;
    indicators: Readonly<Record<string, IndicatorStats>>;
}>;

export const EMPTY_RUN_STATISTICS: RunStatistics = Object.freeze({
    totals: Object.freeze({
        procurementsEvaluated: 0,
        decisionsWritten: 0,
        signalsEvaluated: 0,
        signalsTriggered: 0,
        signalsWritten: 0,
        orphanLotsDropped: 0,
        pagesProcessed: 0,
        pagesFailed: 0,
        durationSec: 0,
    }),
    indicators: Object.freeze({}),
});

export type EvaluationRun = Readonly<{
    runId: number;
    status: RunStatus;
    dataAsOf: string;
    codeCommit: string;
    statistics: RunStatistics;
}>;

export type BaseParameters = Readonly<{
    validFrom: string;
    validTo: string | null;
    source: string;
    note?: string;
}>;

// What a Risk Indicator's assessRisk() (or isEligible()) returns — the
// indicator-specific fields only; ARiskIndicatorDecision.signalFor() fills in
// the rest (identity, subject fields) around it. `state` is the one
// field every branch must supply; everything else defaults when omitted.
export type PartialRiskSignal = Readonly<{
    state: IndicatorState;
    rawValue?: Readonly<Record<string, unknown>> | null;
    threshold?: Readonly<Record<string, unknown>> | null;
    appliedParameters?: Readonly<Record<string, unknown>> | null;
    missingData?: readonly string[];
}>;

// v2 business objects (docs/indicators-story/risk-service-architecture-v2.md
// §2): what the Procurement Reader loads once per run. Sourced from
// v_pirkimas (Procurement, keyed by saltinis+pirkimoNumeris) and
// v_pirkimo_dalis (Lot, keyed by subjektoRaktas). Lot deliberately carries no
// pirkimoBudas of its own — a lot's method is its parent procurement's.
export type Procurement = Readonly<{
    saltinis: string | null;
    pirkimoNumeris: string;
    pavadinimas: string | null;
    jarKodas: string | null;
    pirkimoBudas: string | null;
    statusas: string | null;
    pirkimoObjektoTipas: string | null;
    numatomaVerteEUR: number | null;
    paskelbimoData: string | null;
    pasiulymuPateikimoTerminas: string | null;
    bvpzKodai: readonly string[] | null;
    esFinansavimas: boolean | null;
    lots: readonly Lot[];
    participation: ProcurementParticipation | null;
    procedureOutcome: ProcurementProcedureOutcome | null;
    contractSignatureDates: readonly string[] | null;
}>;

// Distinct-tiekejoKodas participation facts from public.v_dalyviai_v2, merged
// onto a Lot/Procurement by the Procurement Reader's own batch query. null
// means no ATN-1 participation was observed at all for this lot/procurement;
// a non-null object with totalBids/totalSuppliers: 0 is a real, rarer case —
// a participant row exists but every tiekejoKodas in it is NULL.
export type LotParticipation = Readonly<{
    totalBids: number;
    validBids: number;
    reportedAt: string | null;
}>;

export type ProcurementParticipation = Readonly<{
    totalSuppliers: number;
    reportedAt: string | null;
}>;

// One (pirkimoNumeris, daliesNumeris) row from public.v_pirkimo_pabaiga_v2 —
// the per-lot outcome label and decision date LT-OTH-03 needs to compute a
// per-lot evaluation period, which the collapsed lotOutcomes/reportedAt
// aggregates below cannot carry (they lose the label-to-date correlation).
// sprendimoPriezastys (xlsxPPAproceduruPabaiga.sprendimoPriezastys) is the
// report's free-text statement of why the lot's procedure ended the way it
// did — LT-TRA-06 reads this per lot; it is carried alongside the outcome
// label rather than collapsed, for the same reason sprendimoPriemimoData is.
export type ProcedureOutcomeLot = Readonly<{
    daliesNumeris: string;
    proceduruPabaiga: string;
    sprendimoPriemimoData: string | null;
    sprendimoPriezastys: string | null;
}>;

// Procedure-ending outcomes from public.v_pirkimo_pabaiga_v2, merged onto a
// Procurement by the Procurement Reader's own batch query. null means no
// ATN-1 procedure-ending decision was observed for this procurement at all
// (the procedure hasn't concluded yet, or no report was filed). lotOutcomes
// is every distinct "proceduruPabaiga" label observed across the
// procurement's lots — an indicator matches this closed-vocabulary list
// against known outcome labels in code (types.ts carries no judgement of
// which labels mean success), the same convention Bid.atmetimoStatusas
// already uses. lots is the same evidence at its natural per-lot grain (one
// entry per procedure-ending row observed, duplicates included), for an
// indicator that needs a specific lot's outcome paired with its own decision
// date rather than the collapsed cross-lot set. isFramework is
// xlsxPPAataskaitos.preliminariSutartis (LT-PRI-06) — a procurement-level
// fact, not per-lot, aggregated across every report revision filed under
// this pirkimoNumeris with bool_or (true if any revision said so, false if
// every revision said no, null if no revision ever populated the field).
// complaintFiled is xlsxPPAataskaitos.pretenzijaPateikta (LT-TRA-07) — the
// same kind of procurement-level, self-reported, bool_or-aggregated fact as
// isFramework.
export type ProcurementProcedureOutcome = Readonly<{
    lotOutcomes: readonly string[];
    lots: readonly ProcedureOutcomeLot[];
    reportedAt: string | null;
    isFramework: boolean | null;
    complaintFiled: boolean | null;
}>;

// Distinct contract signature ("sudarymoData") dates from
// public.v_pirkimo_sutartys_v2, merged onto a Procurement by the Procurement
// Reader — LT-OTH-04 pairs a lot's own award-decision date (above) against
// the nearest of these on or after it. null means no contract resolved to
// this procurement's pirkimoNumeris at all — the common case: domain-model.md
// §5.2 measures only 6.1% of contracts legally obliged to carry a
// procurement number as actually resolving to one. v_sutartys carries no
// daliesNumeris, so this set is procurement-grain, not per-lot — a plausible
// nearest match, not a verified one-to-one lot-to-contract link. See
// Procurement.contractSignatureDates below.


export type Lot = Readonly<{
    subjektoRaktas: string;
    saltinis: string | null;
    pirkimoNumeris: string;
    daliesNumeris: string;
    daliesPavadinimas: string | null;
    deklaruota: boolean;
    stebeta: boolean;
    dalyviuSkaicius: number | null;
    kainuSkaicius: number | null;
    atmestuSkaicius: number | null;
    participation: LotParticipation | null;
    bids: readonly Bid[];
}>;

// One supplier's individual bid within one lot, from public.v_dalyviai_v2 —
// the "bid" SubjectType's evidence, merged onto Lot.bids by the Procurement
// Reader's own bid-grain query. Distinct from LotParticipation (aggregate
// counts): this is the per-bidder row itself, so a bid-grain indicator can
// judge one supplier's outcome rather than the lot's totals. Only rows
// carrying a tiekejoKodas are loaded — a null-coded participant has no
// durable key to attach a Bid subject to, so it is represented in
// LotParticipation's totalBids/validBids=0 case instead, never here.
export type Bid = Readonly<{
    tiekejoKodas: string;
    eileNumeris: number | null;
    pasiulymoKaina: number | null;
    atmetimoPriezastis: string | null;
    atmetimoStatusas: string | null;
    reportedAt: string | null;
}>;

// The Subject a Risk Indicator's isEligible/assessRisk decide about (v2 §3.4).
// Embeds the object the Procurement Reader already loaded, rather than a bare
// identifier, so a decision doesn't need to re-fetch what the Reader knows.
export type ProcurementSubject = Readonly<{
    subjectType: "procurement";
    subjectKey: string;
    procurementSource: string | null;
    procurementId: string;
    procurement: Procurement;
}>;

// procurement is always non-null: the Procurement Reader only ever builds a
// LotSubject from a Lot already nested inside its parent Procurement.lots. An
// orphan lot — a v_pirkimo_dalis_v2 row whose pirkimoNumeris has no matching
// v_pirkimas_v2 row — never reaches this far; the Reader logs its count and
// drops it before any Subject is built.
export type LotSubject = Readonly<{
    subjectType: "lot";
    subjectKey: string;
    procurementSource: string | null;
    procurementId: string;
    lot: Lot;
    procurement: Procurement;
}>;

// bid is always non-null and drawn from lot.bids: the Procurement Reader
// only ever builds a BidSubject from a Bid already nested inside its parent
// Lot.bids, itself nested inside Procurement.lots — mirroring the
// LotSubject/orphan-lot invariant above, one level deeper.
export type BidSubject = Readonly<{
    subjectType: "bid";
    subjectKey: string;
    procurementSource: string | null;
    procurementId: string;
    bid: Bid;
    lot: Lot;
    procurement: Procurement;
}>;

// "contract"/"supplier" subjects (see SubjectType above) have no Subject
// variant yet — extend this union when the first contract/supplier-level
// indicator is built.
export type Subject = ProcurementSubject | LotSubject | BidSubject;

// What isEligible() returns (v2 §3.4's EligibilityOutcome = eligible |
// RiskSignal, made checkable): either the subject is eligible and
// assessRisk() runs next, or it isn't and this is already the final signal
// (not_applicable / insufficient_data).
export type EligibilityOutcome =
    | Readonly<{ eligible: true }>
    | Readonly<{ eligible: false; signal: RiskSignal }>;

export type RiskIndicatorStandard = Readonly<{
    name: string;
    url: string;
    page?: number;
}>;

export type RiskIndicatorPublicText = Readonly<{
    titleLt: string;
    descriptionLt: string;
    formulaLt: string;
    limitationLt: string;
}>;

// The metadata of one indicator version. definition.ts exports one of these
// per indicator; decision.ts constructs an ARiskIndicatorDecision<F, D>
// around it.
export interface RiskIndicatorDefinition<P extends BaseParameters = BaseParameters> {
    readonly key: RiskIndicatorKey;
    readonly subjectType: SubjectType;
    readonly stage: IndicatorStage;
    readonly references: readonly string[];
    readonly sourceRelations: readonly string[];
    readonly requiredInputs: readonly string[];
    readonly parameters: P;
    readonly standard: RiskIndicatorStandard;
    readonly public: RiskIndicatorPublicText;
}

// Extracts a RiskIndicatorDefinition's own parameter type, so
// ARiskIndicatorDecision<F, D> can type parameters/parameterEntryFor/
// decide against D's own P instead of unknown.
export type ParametersOf<D> = D extends RiskIndicatorDefinition<infer P> ? P : unknown;
