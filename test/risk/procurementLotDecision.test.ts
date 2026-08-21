import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Decision, ParameterEntry, Procurement, ProcurementSubject, RiskIndicatorDefinition, Subject } from "../../modules/risk/types.ts";
import { AProcurementIndicatorDecision } from "../../modules/risk/procurementLotDecision.ts";

// The shared half of every decision (ARiskIndicatorDecision,
// riskIndicatorDecision.ts) plus the procurement-subject eligibility gate
// (AProcurementIndicatorDecision, procurementLotDecision.ts), tested once
// here rather than in each indicator's directory: parameter resolution, the
// shared eligibility gate short-circuiting before decide() runs, the
// insufficient_data rule when hasRequiredData() is false, and every
// observation field a decision does not return.
// ALotIndicatorDecision's own gate (lotEligibility instead of
// procurementEligibility) is exercised by the LT-COM-01/02 indicator tests,
// which are both lot-subject.

const paramsSchema = z.object({ threshold: z.number() });
type TestParameters = z.infer<typeof paramsSchema>;
type TestDefinition = RiskIndicatorDefinition<TestParameters>;

// A minimal AProcurementIndicatorDecision subclass — hasRequiredData/decide
// delegated to whatever makeIndicator() was given. The default decide()
// reads subject.procurement.numatomaVerteEUR directly (a real Procurement
// field) as a stand-in "measured" value, so no synthetic fact-row type is
// needed — every indicator now reads straight off Subject.procurement/
// Subject.lot, which this test mirrors.
class TestProcurementDecision extends AProcurementIndicatorDecision<TestDefinition> {
    protected readonly missingDataWhenAbsent = ["numatomaVerteEUR"];
    private readonly decideFn: (subject: Subject, parameters: TestParameters) => Decision;
    private readonly hasRequiredDataFn: (subject: Subject) => boolean;

    constructor(
        definition: TestDefinition,
        decideFn: (subject: Subject, parameters: TestParameters) => Decision,
        hasRequiredDataFn: (subject: Subject) => boolean = (subject) =>
            subject.subjectType === "procurement" && subject.procurement.numatomaVerteEUR !== null,
    ) {
        super(definition);
        this.decideFn = decideFn;
        this.hasRequiredDataFn = hasRequiredDataFn;
    }

    protected hasRequiredData(subject: Subject): boolean {
        return this.hasRequiredDataFn(subject);
    }

    protected decide(subject: Subject, parameters: TestParameters): Decision {
        return this.decideFn(subject, parameters);
    }
}

const OPEN_ENDED: ParameterEntry<TestParameters> = {
    validFrom: "2026-01-01",
    validTo: null,
    scope: {},
    values: { threshold: 10 },
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
        decide?: (subject: Subject, parameters: TestParameters) => Decision;
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
            parameterSchema: paramsSchema,
            standard: { name: "test", url: "https://example.com" },
            public: {
                titleLt: "Testinis rodiklis",
                descriptionLt: "desc",
                formulaLt: "formula",
                limitationLt: "limitation",
            },
        },
        options.decide ??
            ((decidedSubject, parameters) => {
                const measured = decidedSubject.subjectType === "procurement" ? decidedSubject.procurement.numatomaVerteEUR! : 0;
                return {
                    state: measured < parameters.threshold ? "triggered" : "not_triggered",
                    rawValue: { measured },
                    threshold: { threshold: parameters.threshold },
                };
            }),
        options.hasRequiredData,
    );
}

const RUN = { runId: 7, dataAsOf: "2026-08-01", subjects: null } as const;

describe("AProcurementIndicatorDecision", () => {
    it("assembles the observation fields a decision does not return", () => {
        const [observation] = makeIndicator().evaluate(RUN, [subject({ procurement: { numatomaVerteEUR: 4 } })]);

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

    it("defaults the optional decision fields rather than leaving them undefined", () => {
        const indicator = makeIndicator({ decide: () => ({ state: "insufficient_data" }) });
        const [observation] = indicator.evaluate(RUN, [subject()]);

        expect(observation.rawValue).toBeNull();
        expect(observation.threshold).toBeNull();
        expect(observation.evidence).toEqual({});
        expect(observation.missingData).toEqual([]);
    });

    it("applies the entry whose scope admits each subject's method", () => {
        const indicator = makeIndicator({
            parameters: [
                { ...OPEN_ENDED, scope: { methods: ["open"] }, values: { threshold: 10 } },
                { ...OPEN_ENDED, scope: { methods: ["restricted"] }, values: { threshold: 1 } },
            ],
        });
        const subjects = [
            subject({ subjectKey: "cvpis:1", procurementId: "1", procurement: { pirkimoBudas: "open" } }),
            subject({ subjectKey: "cvpis:2", procurementId: "2", procurement: { pirkimoBudas: "restricted" } }),
        ];

        const [open, restricted] = indicator.evaluate(RUN, subjects);
        expect(open.state).toBe("triggered");
        expect(open.appliedParameters).toEqual({ threshold: 10 });
        expect(restricted.state).toBe("not_triggered");
        expect(restricted.appliedParameters).toEqual({ threshold: 1 });
    });

    // The rule that most wants a single home: a subject no reviewed threshold
    // covers can never be published as triggered.
    it("reports not_applicable without calling decide() when no entry applies", () => {
        const indicator = makeIndicator({
            parameters: [{ ...OPEN_ENDED, scope: { methods: ["open"] } }],
            decide: () => {
                throw new Error("decide() must not be called without an applicable parameter entry");
            },
        });

        const [observation] = indicator.evaluate(RUN, [subject({ procurement: { pirkimoBudas: "negotiated" } })]);
        expect(observation.state).toBe("not_applicable");
        expect(observation.appliedParameters).toBeNull();
        expect(observation.rawValue).toBeNull();
    });

    it("reports not_applicable at a cutoff before the timeline starts", () => {
        const [observation] = makeIndicator().evaluate({ ...RUN, dataAsOf: "2025-01-01" }, [subject()]);
        expect(observation.state).toBe("not_applicable");
    });

    it("reports the shared eligibility gate's signal without calling decide(), for an ineligible subject", () => {
        const indicator = makeIndicator({
            decide: () => {
                throw new Error("decide() must not be called for an ineligible subject");
            },
        });
        const cvppSubject = subject({ procurement: { saltinis: "cvpp", pirkimoBudas: null } });

        const [observation] = indicator.evaluate(RUN, [cvppSubject]);
        expect(observation.state).toBe("not_applicable");
    });

    it("reports insufficient_data without calling decide() when hasRequiredData is false", () => {
        const indicator = makeIndicator({
            decide: () => {
                throw new Error("decide() must not be called when required data is absent");
            },
            hasRequiredData: () => false,
        });

        const [observation] = indicator.evaluate(RUN, [subject()]);
        expect(observation.state).toBe("insufficient_data");
        expect(observation.missingData).toEqual(["numatomaVerteEUR"]);
    });
});
