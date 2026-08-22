import { describe, expect, it } from "vitest";
import type { PartialRiskSignal, ParameterEntry, Procurement, ProcurementSubject, RiskIndicatorDefinition, RiskSignal, Subject } from "../../modules/risk/types.ts";
import { AProcurementIndicatorDecision } from "../../modules/risk/procurementLotDecision.ts";
import { EvaluationContext, type EvaluationRun } from "../../modules/risk/evaluationContext.ts";

// The shared half of every decision (ARiskIndicatorDecision,
// riskIndicatorDecision.ts) plus the procurement-subject eligibility gate
// (AProcurementIndicatorDecision, procurementLotDecision.ts), tested once
// here rather than in each indicator's directory: parameter resolution
// (parameterEntryFor), the shared eligibility gate short-circuiting before
// assessRisk() runs, the insufficient_data rule when hasRequiredData() is
// false, and every observation field a partial signal does not return.
// ALotIndicatorDecision's own gate (lotEligibility instead of
// procurementEligibility) is exercised by the LT-COM-01/02 indicator tests,
// which are both lot-subject.
//
// Batching over a subject universe is RiskDecisionEngine's job, not this
// class's (riskDecisionEngine.ts) — decideSubject() below replays only the
// two-step per-subject protocol the Engine itself uses (isEligible, then
// assessRisk if eligible), against one subject at a time.

type TestParameters = Readonly<{ threshold: number }>;
type TestDefinition = RiskIndicatorDefinition<TestParameters>;

// A minimal AProcurementIndicatorDecision subclass — hasRequiredData/assessRisk
// delegated to whatever makeIndicator() was given. The default judgeFn reads
// subject.procurement.numatomaVerteEUR directly (a real Procurement field) as
// a stand-in "measured" value, so no synthetic fact-row type is needed —
// every indicator now reads straight off Subject.procurement/Subject.lot,
// which this test mirrors.
class TestProcurementDecision extends AProcurementIndicatorDecision<TestDefinition> {
    protected readonly missingDataWhenAbsent = ["numatomaVerteEUR"];
    private readonly judgeFn: (subject: Subject, parameters: TestParameters) => PartialRiskSignal;
    private readonly hasRequiredDataFn: (subject: Subject) => boolean;

    constructor(
        definition: TestDefinition,
        judgeFn: (subject: Subject, parameters: TestParameters) => PartialRiskSignal,
        hasRequiredDataFn: (subject: Subject) => boolean = (subject) =>
            subject.subjectType === "procurement" && subject.procurement.numatomaVerteEUR !== null,
    ) {
        super(definition);
        this.judgeFn = judgeFn;
        this.hasRequiredDataFn = hasRequiredDataFn;
    }

    protected hasRequiredData(subject: Subject): boolean {
        return this.hasRequiredDataFn(subject);
    }

    assessRisk(subject: Subject, context: EvaluationContext): RiskSignal {
        const entry = this.parameterEntryFor(context.dataAsOf);
        if (entry === null) {
            return this.signalFor(subject, context, { state: "not_applicable" });
        }
        const partial = this.judgeFn(subject, entry);
        return this.signalFor(subject, context, { ...partial, appliedParameters: { threshold: entry.threshold } });
    }
}

const OPEN_ENDED: ParameterEntry<TestParameters> = {
    validFrom: "2026-01-01",
    validTo: null,
    threshold: 10,
    source: "test",
};

function testProcurement(overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "1",
        pavadinimas: null,
        jarKodas: null,
        pirkimoBudas: "Atviras konkursas",
        statusas: null,
        pirkimoObjektoTipas: null,
        numatomaVerteEUR: 4,
        paskelbimoData: null,
        pasiulymuPateikimoTerminas: null,
        bvpzKodai: null,
        esFinansavimas: null,
        lots: [],
        participation: null,
        ...overrides,
    };
}

function subject(
    overrides: Omit<Partial<ProcurementSubject>, "procurement"> & { procurement?: Partial<Procurement> } = {},
): ProcurementSubject {
    const { procurement: procurementOverrides, ...rest } = overrides;
    return {
        subjectType: "procurement",
        subjectKey: "cvpis:1",
        procurementSource: "cvpis",
        procurementId: "1",
        procurement: testProcurement(procurementOverrides),
        ...rest,
    };
}

function makeIndicator(
    options: {
        parameters?: readonly ParameterEntry<TestParameters>[];
        judge?: (subject: Subject, parameters: TestParameters) => PartialRiskSignal;
        hasRequiredData?: (subject: Subject) => boolean;
    } = {},
): TestProcurementDecision {
    return new TestProcurementDecision(
        {
            key: { id: "LT-TEST-01", version: 3 },
            lifecycle: "active",
            subjectType: "procurement",
            stage: "tender",
            references: [],
            sourceRelations: [],
            requiredInputs: [],
            parameters: options.parameters ?? [OPEN_ENDED],
            standard: { name: "test", url: "https://example.com" },
            public: {
                titleLt: "Testinis rodiklis",
                descriptionLt: "desc",
                formulaLt: "formula",
                limitationLt: "limitation",
            },
        },
        options.judge ??
            ((judgedSubject, parameters) => {
                const measured = judgedSubject.subjectType === "procurement" ? judgedSubject.procurement.numatomaVerteEUR! : 0;
                return {
                    state: measured < parameters.threshold ? "triggered" : "not_triggered",
                    rawValue: { measured },
                    threshold: { threshold: parameters.threshold },
                };
            }),
        options.hasRequiredData,
    );
}

const RUN: EvaluationRun = { runId: 7, dataAsOf: "2026-08-01", subjects: null };

// The per-subject protocol RiskDecisionEngine itself uses
// (riskDecisionEngine.ts's private decide()) — isEligible, then assessRisk
// only if eligible — replayed here against one subject, with a context built
// the same way the Engine builds one per indicator.
function decideSubject(indicator: TestProcurementDecision, subject: ProcurementSubject, run: EvaluationRun = RUN): RiskSignal {
    const context = new EvaluationContext(run, indicator.parametersAsOf(run.dataAsOf));
    const outcome = indicator.isEligible(subject, context);
    return outcome.eligible ? indicator.assessRisk(subject, context) : outcome.signal;
}

describe("AProcurementIndicatorDecision", () => {
    it("assembles the observation fields a partial signal does not return", () => {
        const observation = decideSubject(makeIndicator(), subject({ procurement: { numatomaVerteEUR: 4 } }));

        expect(observation).toEqual({
            indicatorId: "LT-TEST-01",
            indicatorVersion: 3,
            subjectType: "procurement",
            subjectKey: "cvpis:1",
            procurementSource: "cvpis",
            procurementId: "1",
            state: "triggered",
            rawValue: { measured: 4 },
            threshold: { threshold: 10 },
            appliedParameters: { threshold: 10 },
            evidence: {},
            missingData: [],
            dataAsOf: "2026-08-01",
        });
    });

    it("defaults the optional signal fields rather than leaving them undefined", () => {
        const indicator = makeIndicator({ judge: () => ({ state: "insufficient_data" }) });
        const observation = decideSubject(indicator, subject());

        expect(observation.rawValue).toBeNull();
        expect(observation.threshold).toBeNull();
        expect(observation.evidence).toEqual({});
        expect(observation.missingData).toEqual([]);
    });

    it("applies the entry in force at the run's cutoff", () => {
        const indicator = makeIndicator({
            parameters: [
                { ...OPEN_ENDED, validTo: "2026-06-01", threshold: 10 },
                { validFrom: "2026-06-01", validTo: null, threshold: 1, source: "test" },
            ],
        });

        const before = decideSubject(indicator, subject(), { ...RUN, dataAsOf: "2026-03-01" });
        expect(before.state).toBe("triggered");
        expect(before.appliedParameters).toEqual({ threshold: 10 });

        const after = decideSubject(indicator, subject(), { ...RUN, dataAsOf: "2026-08-01" });
        expect(after.state).toBe("not_triggered");
        expect(after.appliedParameters).toEqual({ threshold: 1 });
    });

    // The rule that most wants a single home: a subject no reviewed threshold
    // covers can never be published as triggered.
    it("reports not_applicable without calling judge() when no entry covers the cutoff", () => {
        const indicator = makeIndicator({
            parameters: [OPEN_ENDED],
            judge: () => {
                throw new Error("judge() must not be called without an applicable parameter entry");
            },
        });

        const observation = decideSubject(indicator, subject(), { ...RUN, dataAsOf: "2020-01-01" });
        expect(observation.state).toBe("not_applicable");
        expect(observation.appliedParameters).toBeNull();
        expect(observation.rawValue).toBeNull();
    });

    it("reports not_applicable at a cutoff before the timeline starts", () => {
        const observation = decideSubject(makeIndicator(), subject(), { ...RUN, dataAsOf: "2025-01-01" });
        expect(observation.state).toBe("not_applicable");
    });

    it("reports the shared eligibility gate's signal without calling judge(), for an ineligible subject", () => {
        const indicator = makeIndicator({
            judge: () => {
                throw new Error("judge() must not be called for an ineligible subject");
            },
        });
        const cvppSubject = subject({ procurement: { saltinis: "cvpp", pirkimoBudas: null } });

        const observation = decideSubject(indicator, cvppSubject);
        expect(observation.state).toBe("not_applicable");
    });

    it("reports insufficient_data without calling judge() when hasRequiredData is false", () => {
        const indicator = makeIndicator({
            judge: () => {
                throw new Error("judge() must not be called when required data is absent");
            },
            hasRequiredData: () => false,
        });

        const observation = decideSubject(indicator, subject());
        expect(observation.state).toBe("insufficient_data");
        expect(observation.missingData).toEqual(["numatomaVerteEUR"]);
    });
});
