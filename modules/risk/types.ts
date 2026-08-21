import type { z } from "zod";

// Every pure type in the Procurement Risk Service — no runtime behaviour.
// Runtime schemas/validators live in contracts.ts; behaviour lives in
// riskIndicatorDecision.ts, procurementLotDecision.ts, evaluationContext.ts,
// and riskDataSource.ts. See
// docs/indicators-story/risk-service-architecture-v2.md §3.4.

export type IndicatorLifecycle = "draft" | "shadow" | "active" | "retired";
export type IndicatorStage = "planning" | "tender" | "award" | "contract";
export type SubjectType = "procurement" | "lot" | "contract" | "supplier";

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

// v2's RiskSignal (architecture-v2.md §3.4), validated at runtime by
// contracts.ts's riskSignalSchema. indicatorVersion is required even though
// the v2 diagram's RiskSignal doesn't list it: risk.risk_signals requires it
// NOT NULL, and the DB schema/Signal Writer already depend on this exact
// shape.
export type RiskSignal = Readonly<{
    indicatorId: string;
    indicatorVersion: number;
    subjectType: SubjectType;
    subjectKey: string;
    procurementSource: string | null;
    procurementId: string | null;
    state: IndicatorState;
    rawValue: Readonly<Record<string, unknown>> | null;
    threshold: Readonly<Record<string, unknown>> | null;
    appliedParameters: Readonly<Record<string, unknown>> | null;
    evidence: Readonly<Record<string, unknown>>;
    missingData: readonly string[];
    dataAsOf: string;
}>;

// Which subjects an entry's values apply to; see parameterScope.ts and
// docs/indicators-story/risk-service-architecture.md §4.5.
export type ParameterScope = Readonly<{
    methods?: readonly string[];
    objectTypes?: readonly string[];
}>;

// One effective-dated entry of a parameter timeline. `validTo: null` means
// still in force.
//
// `source` and `note` are published verbatim with the entry
// (deployedIndicators.ts). `note` is optional.
export type ParameterEntry<P> = Readonly<{
    validFrom: string;
    validTo: string | null;
    scope: ParameterScope;
    values: P;
    source: string;
    note?: string;
}>;

// The columns every collect.sql returns, in addition to whatever else it
// measures. See docs/indicators-story/risk-service-architecture.md §4.1.
export type SubjectFacts = Readonly<{
    subjectKey: string;
    procurementSource: string | null;
    procurementId: string | null;
    // Read by scopeAdmits (parameterScope.ts) when a parameter entry
    // narrows this dimension.
    method?: string | null;
    objectType?: string | null;
}>;

// The fields a decide() method returns; ARiskIndicatorDecision
// (riskIndicatorDecision.ts) assembles the rest of a RiskSignal around them.
export type Decision = Readonly<{
    state: IndicatorState;
    rawValue?: Readonly<Record<string, unknown>> | null;
    threshold?: Readonly<Record<string, unknown>> | null;
    evidence?: Readonly<Record<string, unknown>>;
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
}>;

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

// procurement is nullable: v_pirkimo_dalis can produce a lot whose
// pirkimoNumeris has no matching v_pirkimas row (an orphan lot — the same
// case today's "unmatched procurement" fixture covers). Requiring a non-null
// parent here would make such lots unreachable as Subjects, silently
// dropping them from risk_signals instead of producing the insufficient_data
// row they produce today.
export type LotSubject = Readonly<{
    subjectType: "lot";
    subjectKey: string;
    procurementSource: string | null;
    procurementId: string;
    lot: Lot;
    procurement: Procurement | null;
}>;

// "contract"/"supplier" subjects (see SubjectType above) have no Subject
// variant yet — extend this union when the first contract/supplier-level
// indicator is built.
export type Subject = ProcurementSubject | LotSubject;

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
export interface RiskIndicatorDefinition<P = unknown> {
    readonly key: RiskIndicatorKey;
    readonly lifecycle: IndicatorLifecycle;
    readonly subjectType: SubjectType;
    readonly stage: IndicatorStage;
    readonly references: readonly string[];
    readonly sourceRelations: readonly string[];
    readonly requiredInputs: readonly string[];
    readonly parameters: readonly ParameterEntry<P>[];
    // The shape and value constraints one entry's `values` must satisfy;
    // zodContract() wraps it into a parameterContract in
    // riskIndicatorDecision.ts.
    readonly parameterSchema: z.ZodType<P>;
    readonly outputContract?: RuntimeContract<RiskSignal>;
    readonly standard: RiskIndicatorStandard;
    readonly public: RiskIndicatorPublicText;
}

// Extracts a RiskIndicatorDefinition's own parameter type, so
// ARiskIndicatorDecision<F, D> can type parametersAsOf/parameterEntryFor/
// decide against D's own P instead of unknown.
export type ParametersOf<D> = D extends RiskIndicatorDefinition<infer P> ? P : unknown;
