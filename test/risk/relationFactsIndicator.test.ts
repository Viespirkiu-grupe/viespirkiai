import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Decision, ParameterEntry, Procurement, ProcurementSubject, Subject } from "../../modules/risk/contracts.ts";
import { RelationFactsIndicator } from "../../modules/risk/relationFactsIndicator.ts";
import type { RiskDataSource } from "../../modules/risk/riskDataSource.ts";

// The shared half of every relation-facts indicator, tested once here rather
// than in each indicator's directory (mirrors how subjectFactsIndicator.test.ts
// covered SubjectFactsIndicator before the v2 port): bulk-query argument
// binding, parameter resolution, the shared eligibility gate short-circuiting
// before decide() runs, the insufficient_data rule when the bulk query has no
// row for a subject, and every observation field a decision does not return.

const paramsSchema = z.object({ threshold: z.number() });
type TestParameters = z.infer<typeof paramsSchema>;

type TestFacts = Readonly<{ key: string; method: string | null; measured: number }>;

const OPEN_ENDED: ParameterEntry<TestParameters> = {
    validFrom: "2026-01-01",
    validTo: null,
    scope: {},
    values: { threshold: 10 },
    source: "test",
};

// Records what the class asked the database for, and answers with fixed rows.
class StubDataSource implements RiskDataSource {
    calls: { sqlText: string; params: readonly unknown[] }[] = [];

    constructor(private readonly rows: readonly unknown[]) {}

    async query<T>(sqlText: string, params: readonly unknown[] = []): Promise<readonly T[]> {
        this.calls.push({ sqlText, params });
        return this.rows as readonly T[];
    }
}

function testProcurement(overrides: Partial<Procurement> = {}): Procurement {
    return {
        saltinis: "cvpis",
        pirkimoNumeris: "1",
        pavadinimas: null,
        jarKodas: null,
        pirkimoBudas: "Atviras konkursas",
        statusas: null,
        pirkimoObjektoTipas: null,
        numatomaVerteEUR: null,
        paskelbimoData: null,
        pasiulymuPateikimoTerminas: null,
        bvpzKodai: null,
        esFinansavimas: null,
        lots: [],
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

function facts(overrides: Partial<TestFacts> = {}): TestFacts {
    return { key: "cvpis:1", method: "open", measured: 4, ...overrides };
}

function makeIndicator(
    options: {
        parameters?: readonly ParameterEntry<TestParameters>[];
        decide?: (subject: Subject, facts: TestFacts, parameters: TestParameters) => Decision;
    } = {},
) {
    return new RelationFactsIndicator<TestFacts, TestParameters>(
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
            sqlFile: "./fixtures/collect.sql",
            factKey: (row) => row.key,
            subjectKey: (s) => s.subjectKey,
            methodOf: (row) => row.method,
            missingDataWhenAbsent: ["tiekejoKodas"],
            decide:
                options.decide ??
                ((_s, row, parameters) => ({
                    state: row.measured < parameters.threshold ? "triggered" : "not_triggered",
                    rawValue: { measured: row.measured },
                    threshold: { threshold: parameters.threshold },
                })),
        },
        import.meta.url,
    );
}

const RUN = { runId: 7, dataAsOf: "2026-08-01", subjects: null } as const;

describe("RelationFactsIndicator", () => {
    it("binds the cutoff and the subject filter, and nothing else", async () => {
        const data = new StubDataSource([facts()]);
        await makeIndicator().evaluate({ ...RUN, subjects: ["1", "2"] }, [subject()], data);

        expect(data.calls).toHaveLength(1);
        expect(data.calls[0].params).toEqual(["2026-08-01", ["1", "2"]]);
    });

    it("passes NULL as the subject filter for a full run", async () => {
        const data = new StubDataSource([facts()]);
        await makeIndicator().evaluate(RUN, [subject()], data);
        expect(data.calls[0].params).toEqual(["2026-08-01", null]);
    });

    it("assembles the observation fields a decision does not return", async () => {
        const data = new StubDataSource([facts({ measured: 4 })]);
        const [observation] = await makeIndicator().evaluate(RUN, [subject()], data);

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

    it("defaults the optional decision fields rather than leaving them undefined", async () => {
        const data = new StubDataSource([facts()]);
        const indicator = makeIndicator({ decide: () => ({ state: "insufficient_data" }) });
        const [observation] = await indicator.evaluate(RUN, [subject()], data);

        expect(observation.rawValue).toBeNull();
        expect(observation.threshold).toBeNull();
        expect(observation.evidence).toEqual({});
        expect(observation.missingData).toEqual([]);
    });

    it("applies the entry whose scope admits each subject's fact row", async () => {
        const data = new StubDataSource([
            facts({ key: "cvpis:1", method: "open" }),
            facts({ key: "cvpis:2", method: "restricted" }),
        ]);
        const indicator = makeIndicator({
            parameters: [
                { ...OPEN_ENDED, scope: { methods: ["open"] }, values: { threshold: 10 } },
                { ...OPEN_ENDED, scope: { methods: ["restricted"] }, values: { threshold: 1 } },
            ],
        });
        const subjects = [
            subject({ subjectKey: "cvpis:1", procurementId: "1" }),
            subject({ subjectKey: "cvpis:2", procurementId: "2" }),
        ];

        const [open, restricted] = await indicator.evaluate(RUN, subjects, data);
        expect(open.state).toBe("triggered");
        expect(open.appliedParameters).toEqual({ threshold: 10 });
        expect(restricted.state).toBe("not_triggered");
        expect(restricted.appliedParameters).toEqual({ threshold: 1 });
    });

    // The rule that most wants a single home: a subject no reviewed threshold
    // covers can never be published as triggered.
    it("reports not_applicable without calling the rules when no entry applies", async () => {
        const data = new StubDataSource([facts({ method: "negotiated" })]);
        const indicator = makeIndicator({
            parameters: [{ ...OPEN_ENDED, scope: { methods: ["open"] } }],
            decide: () => {
                throw new Error("the rules must not be called without an applicable parameter entry");
            },
        });

        const [observation] = await indicator.evaluate(RUN, [subject()], data);
        expect(observation.state).toBe("not_applicable");
        expect(observation.appliedParameters).toBeNull();
        expect(observation.rawValue).toBeNull();
    });

    it("reports not_applicable at a cutoff before the timeline starts", async () => {
        const data = new StubDataSource([facts()]);
        const [observation] = await makeIndicator().evaluate({ ...RUN, dataAsOf: "2025-01-01" }, [subject()], data);
        expect(observation.state).toBe("not_applicable");
    });

    // New in the v2 port: the shared Procurement/Lot Eligibility Decision
    // runs before the rules ever see the subject.
    it("reports the shared eligibility gate's signal without calling the rules, for an ineligible subject", async () => {
        const data = new StubDataSource([facts()]);
        const indicator = makeIndicator({
            decide: () => {
                throw new Error("the rules must not be called for an ineligible subject");
            },
        });
        const cvppSubject = subject({ procurement: { saltinis: "cvpp", pirkimoBudas: null } });

        const [observation] = await indicator.evaluate(RUN, [cvppSubject], data);
        expect(observation.state).toBe("not_applicable");
    });

    it("reports insufficient_data without calling the rules when the bulk query has no row for a subject", async () => {
        const data = new StubDataSource([]); // no facts row for any subject
        const indicator = makeIndicator({
            decide: () => {
                throw new Error("the rules must not be called when no fact row was found");
            },
        });

        const [observation] = await indicator.evaluate(RUN, [subject()], data);
        expect(observation.state).toBe("insufficient_data");
        expect(observation.missingData).toEqual(["tiekejoKodas"]);
    });
});
