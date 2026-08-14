import { describe, expect, it } from "vitest";
import { z } from "zod";
import { zodContract, type ParameterEntry, type SubjectFacts, type Decision } from "../../modules/risk/contracts.ts";
import { SubjectFactsIndicator } from "../../modules/risk/subjectFactsIndicator.ts";
import type { RiskDataSource } from "../../modules/risk/riskDataSource.ts";

// The shared half of every row-local indicator, tested once here rather than
// in each indicator's directory (risk-service-architecture.md §8): argument
// binding, parameter resolution, the not_applicable rule, and every
// observation field a decision does not return.

const paramsSchema = z.object({ threshold: z.number() });
const paramsContract = zodContract(paramsSchema);
type TestParameters = z.infer<typeof paramsSchema>;

type TestFacts = SubjectFacts & Readonly<{ measured: number }>;

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

function facts(overrides: Partial<TestFacts> = {}): TestFacts {
    return {
        subjectKey: "cvpis:1",
        procurementSource: "cvpis",
        procurementId: "1",
        method: "open",
        measured: 4,
        ...overrides,
    };
}

function makeIndicator(
    options: {
        parameters?: readonly ParameterEntry<TestParameters>[];
        decide?: (facts: TestFacts, parameters: TestParameters) => Decision;
    } = {},
) {
    return new SubjectFactsIndicator<TestFacts, TestParameters>(
        {
            key: { id: "LT-TEST-01", version: 3 },
            lifecycle: "active",
            subjectType: "procurement",
            stage: "tender",
            references: [],
            sourceRelations: [],
            requiredInputs: [],
            parameters: options.parameters ?? [OPEN_ENDED],
            parameterContract: paramsContract,
            standard: { name: "test", url: "https://example.com" },
            public: {
                titleLt: "Testinis rodiklis",
                descriptionLt: "desc",
                formulaLt: "formula",
                limitationLt: "limitation",
            },
            sqlFile: "./fixtures/collect.sql",
            decide:
                options.decide ??
                ((row, parameters) => ({
                    state: row.measured < parameters.threshold ? "triggered" : "not_triggered",
                    rawValue: { measured: row.measured },
                    threshold: { threshold: parameters.threshold },
                })),
        },
        import.meta.url,
    );
}

const RUN = { runId: 7, dataAsOf: "2026-08-01", subjects: null } as const;

describe("SubjectFactsIndicator", () => {
    it("binds the cutoff and the subject filter, and nothing else", async () => {
        const data = new StubDataSource([facts()]);
        await makeIndicator().evaluate({ ...RUN, subjects: ["1", "2"] }, data);

        expect(data.calls).toHaveLength(1);
        expect(data.calls[0].params).toEqual(["2026-08-01", ["1", "2"]]);
    });

    it("passes NULL as the subject filter for a full run", async () => {
        const data = new StubDataSource([facts()]);
        await makeIndicator().evaluate(RUN, data);
        expect(data.calls[0].params).toEqual(["2026-08-01", null]);
    });

    it("assembles the observation fields a decision does not return", async () => {
        const data = new StubDataSource([facts({ measured: 4 })]);
        const [observation] = await makeIndicator().evaluate(RUN, data);

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
        const [observation] = await indicator.evaluate(RUN, data);

        expect(observation.rawValue).toBeNull();
        expect(observation.threshold).toBeNull();
        expect(observation.evidence).toEqual({});
        expect(observation.missingData).toEqual([]);
    });

    it("applies the entry whose scope admits each row", async () => {
        const data = new StubDataSource([
            facts({ subjectKey: "cvpis:1", method: "open" }),
            facts({ subjectKey: "cvpis:2", method: "restricted" }),
        ]);
        const indicator = makeIndicator({
            parameters: [
                { ...OPEN_ENDED, scope: { methods: ["open"] }, values: { threshold: 10 } },
                { ...OPEN_ENDED, scope: { methods: ["restricted"] }, values: { threshold: 1 } },
            ],
        });

        const [open, restricted] = await indicator.evaluate(RUN, data);
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

        const [observation] = await indicator.evaluate(RUN, data);
        expect(observation.state).toBe("not_applicable");
        expect(observation.appliedParameters).toBeNull();
        expect(observation.rawValue).toBeNull();
    });

    it("reports not_applicable at a cutoff before the timeline starts", async () => {
        const data = new StubDataSource([facts()]);
        const [observation] = await makeIndicator().evaluate({ ...RUN, dataAsOf: "2025-01-01" }, data);
        expect(observation.state).toBe("not_applicable");
    });

    it("names the collection statement when it returns a row without the shared columns", async () => {
        const data = new StubDataSource([{ measured: 4 }]);
        await expect(makeIndicator().evaluate(RUN, data)).rejects.toThrow(
            /collect\.sql returned a row that is not a valid SubjectFacts/,
        );
    });
});
