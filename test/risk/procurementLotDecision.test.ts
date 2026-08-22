import { describe, expect, it } from "vitest";
import type { PartialRiskSignal, BaseParameters, Procurement, ProcurementSubject, RiskIndicatorDefinition, RiskSignal } from "../../modules/risk/types.ts";
import { AProcurementIndicatorDecision } from "../../modules/risk/procurementLotDecision.ts";
import { EvaluationContext } from "../../modules/risk/evaluationContext.ts";

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

interface TestParameters extends BaseParameters {
    readonly threshold: number;
}
type TestDefinition = RiskIndicatorDefinition<TestParameters>;

// A minimal AProcurementIndicatorDecision subclass — hasRequiredData/assessRisk
// delegated to whatever makeIndicator() was given. The default judgeFn reads
// subject.procurement.numatomaVerteEUR directly (a real Procurement field) as
// a stand-in "measured" value, so no synthetic fact-row type is needed —
// every indicator now reads straight off Subject.procurement/Subject.lot,
// which this test mirrors.
class TestProcurementDecision extends AProcurementIndicatorDecision<TestDefinition> {
    protected readonly missingDataWhenAbsent = ["numatomaVerteEUR"];
    private readonly judgeFn: (subject: ProcurementSubject, parameters: TestParameters) => PartialRiskSignal;
    private readonly hasRequiredDataFn: (subject: ProcurementSubject) => boolean;

    constructor(
        definition: TestDefinition,
        context: EvaluationContext,
        judgeFn: (subject: ProcurementSubject, parameters: TestParameters) => PartialRiskSignal,
        hasRequiredDataFn: (subject: ProcurementSubject) => boolean = (subject) =>
            subject.procurement.numatomaVerteEUR !== null,
    ) {
        super(definition, context);
        this.judgeFn = judgeFn;
        this.hasRequiredDataFn = hasRequiredDataFn;
    }

    protected hasRequiredData(subject: ProcurementSubject): boolean {
        return this.hasRequiredDataFn(subject);
    }

    assessRisk(subject: ProcurementSubject): RiskSignal {
        const entry = this.parameterEntryFor(this.context.dataAsOf);
        if (entry === null) {
            return this.signalFor(subject, { state: "not_applicable" });
        }
        const partial = this.judgeFn(subject, entry);
        return this.signalFor(subject, { ...partial, appliedParameters: { threshold: entry.threshold } });
    }
}

const OPEN_ENDED: TestParameters = {
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

const RUN = Object.freeze({ runId: 7, dataAsOf: "2026-08-01", subjects: null }) as Readonly<{
    runId: number;
    dataAsOf: string;
    subjects: readonly string[] | null;
}>;

function makeIndicator(
    options: {
        parameters?: TestParameters;
        judge?: (subject: ProcurementSubject, parameters: TestParameters) => PartialRiskSignal;
        hasRequiredData?: (subject: ProcurementSubject) => boolean;
        run?: typeof RUN;
    } = {},
): TestProcurementDecision {
    return new TestProcurementDecision(
        {
            key: { id: "LT-TEST-01", version: 3 },
            subjectType: "procurement",
            stage: "tender",
            references: [],
            sourceRelations: [],
            requiredInputs: [],
            parameters: options.parameters ?? OPEN_ENDED,
            standard: { name: "test", url: "https://example.com" },
            public: {
                titleLt: "Testinis rodiklis",
                descriptionLt: "desc",
                formulaLt: "formula",
                limitationLt: "limitation",
            },
        },
        new EvaluationContext(options.run ?? RUN),
        options.judge ??
            ((judgedSubject, parameters) => {
                const measured = judgedSubject.procurement.numatomaVerteEUR!;
                return {
                    state: measured < parameters.threshold ? "triggered" : "not_triggered",
                    rawValue: { measured },
                    threshold: { threshold: parameters.threshold },
                };
            }),
        options.hasRequiredData,
    );
}

// The per-subject protocol RiskDecisionEngine itself uses
// (riskDecisionEngine.ts's private decide()) — isEligible, then assessRisk
// only if eligible — replayed here against one subject. The indicator's
// context is fixed at construction (indicator.context, per
// ARiskIndicatorDecision), so tests that need a different dataAsOf build a
// fresh indicator via makeIndicator({ run }) rather than passing a context
// here.
function decideSubject(indicator: TestProcurementDecision, subject: ProcurementSubject): RiskSignal {
    const outcome = indicator.isEligible(subject);
    return outcome.eligible ? indicator.assessRisk(subject) : outcome.signal;
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
            missingData: [],
            dataAsOf: "2026-08-01",
        });
    });

    it("defaults the optional signal fields rather than leaving them undefined", () => {
        const indicator = makeIndicator({ judge: () => ({ state: "insufficient_data" }) });
        const observation = decideSubject(indicator, subject());

        expect(observation.rawValue).toBeNull();
        expect(observation.threshold).toBeNull();
        expect(observation.missingData).toEqual([]);
    });

    it("applies the parameters only within their validFrom/validTo window", () => {
        const before = decideSubject(
            makeIndicator({
                parameters: { ...OPEN_ENDED, validTo: "2026-06-01" },
                run: { ...RUN, dataAsOf: "2026-03-01" },
            }),
            subject(),
        );
        expect(before.state).toBe("triggered");
        expect(before.appliedParameters).toEqual({ threshold: 10 });

        const after = decideSubject(
            makeIndicator({
                parameters: { ...OPEN_ENDED, validTo: "2026-06-01" },
                run: { ...RUN, dataAsOf: "2026-08-01" },
            }),
            subject(),
        );
        expect(after.state).toBe("not_applicable");
        expect(after.appliedParameters).toBeNull();
    });

    // The rule that most wants a single home: a subject no reviewed threshold
    // covers can never be published as triggered.
    it("reports not_applicable without calling judge() when the cutoff is outside the parameters' window", () => {
        const indicator = makeIndicator({
            parameters: OPEN_ENDED,
            judge: () => {
                throw new Error("judge() must not be called without applicable parameters");
            },
            run: { ...RUN, dataAsOf: "2020-01-01" },
        });

        const observation = decideSubject(indicator, subject());
        expect(observation.state).toBe("not_applicable");
        expect(observation.appliedParameters).toBeNull();
        expect(observation.rawValue).toBeNull();
    });

    it("reports not_applicable at a cutoff before the timeline starts", () => {
        const observation = decideSubject(makeIndicator({ run: { ...RUN, dataAsOf: "2025-01-01" } }), subject());
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
