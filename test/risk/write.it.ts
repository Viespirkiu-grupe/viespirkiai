// Integration tests for the Decision Writer (services/procurement-risk/
// write.ts), against the local risk-dev Postgres. Protects the storage
// decision docs/indicators-story/risk-service-architecture.md §2.4 depends
// on: risk_procurement_decisions is current-state, one row per procurement,
// refreshed in place by INSERT ... ON CONFLICT DO UPDATE.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { riskDb } from "../../postgres/riskDb.js";
import { writeDecisions } from "../../services/procurement-risk/write.ts";
import type { ProcurementRiskDecisions, RiskSignal } from "../../modules/risk/types.ts";

const INDICATOR_ID = "LT-WRITE-TEST-01";

function signal(overrides: Partial<RiskSignal> = {}): RiskSignal {
    return {
        indicatorId: INDICATOR_ID,
        indicatorVersion: 1,
        subjectType: "procurement",
        subjectKey: "cvpis:1",
        state: "triggered",
        rawValue: { a: 1 },
        threshold: { a: 1 },
        appliedParameters: { a: 1 },
        missingData: [],
        dataAsOf: "2026-08-12T00:00:00.000Z",
        ...overrides,
    };
}

function decisions(overrides: Partial<ProcurementRiskDecisions> = {}): ProcurementRiskDecisions {
    const now = new Date();
    return {
        procurementSource: "cvpis",
        procurementId: "1",
        runId: 0,
        signals: [signal()],
        dataAsOf: "2026-08-12T00:00:00.000Z",
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await riskDb.connect();
    try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

async function decisionsFor(procurementSource: string, procurementId: string) {
    const { rows } = await riskDb.query(
        `SELECT * FROM risk.risk_procurement_decisions WHERE procurement_source = $1 AND procurement_id = $2`,
        [procurementSource, procurementId],
    );
    return rows;
}

// These tests don't exercise the run open/close lifecycle, so runs are
// inserted pre-closed to avoid colliding with the partial unique index on
// status = 'running'.
async function openRun(): Promise<number> {
    const { rows } = await riskDb.query<{ id: number }>(
        `INSERT INTO risk.risk_evaluation_runs (data_as_of, code_commit, status)
         VALUES (now(), 'test', 'succeeded')
         RETURNING id`,
    );
    return rows[0].id;
}

// Clears the whole sandbox schema, not just this file's rows: v_latest_run
// is a property of the runs table as a whole, so a leftover run from a
// manual `npm run risk:run` would otherwise decide which row's provenance
// these tests see. The DELETE grant this relies on is test-only — see
// migrations/risk/test/000_grants.sql; nothing may delete a row in
// production, rows are only ever overwritten.
async function cleanUp(): Promise<void> {
    await riskDb.query(`DELETE FROM risk.risk_procurement_decisions`);
    await riskDb.query(`DELETE FROM risk.risk_evaluation_runs`);
}

beforeAll(cleanUp);
afterEach(cleanUp);
afterAll(async () => {
    await riskDb.end();
});

describe("Decision Writer", () => {
    it("inserts one row per procurement", async () => {
        const runId = await openRun();
        const stats = await withTransaction((client) =>
            writeDecisions(client, runId, [
                decisions({ procurementId: "1" }),
                decisions({ procurementId: "2" }),
            ]),
        );
        expect(stats).toEqual({ written: 2 });

        expect(await decisionsFor("cvpis", "1")).toHaveLength(1);
        expect(await decisionsFor("cvpis", "2")).toHaveLength(1);
    });

    it("writes nothing for an empty page", async () => {
        const runId = await openRun();
        const stats = await withTransaction((client) => writeDecisions(client, runId, []));
        expect(stats).toEqual({ written: 0 });
    });

    // The point of the model: a later run refreshes the same procurement's row
    // in place rather than appending a new one.
    it("refreshes an existing procurement's row in place, keeping created_at and advancing updated_at", async () => {
        const runId1 = await openRun();
        await withTransaction((client) => writeDecisions(client, runId1, [decisions({ signals: [signal({ state: "triggered" })] })]));
        const [first] = await decisionsFor("cvpis", "1");

        const runId2 = await openRun();
        await withTransaction((client) =>
            writeDecisions(client, runId2, [decisions({ signals: [signal({ state: "not_triggered" })] })]),
        );
        const rows = await decisionsFor("cvpis", "1");

        expect(rows).toHaveLength(1);
        expect(rows[0].run_id).toBe(String(runId2));
        expect(rows[0].signals[0].state).toBe("not_triggered");
        expect(rows[0].created_at).toEqual(first.created_at);
        expect(new Date(rows[0].updated_at).getTime()).toBeGreaterThanOrEqual(new Date(first.updated_at).getTime());
    });

    it("holds every signal for a procurement (procurement, lot and bid grains) as one jsonb array", async () => {
        const runId = await openRun();
        const mixedSignals = [
            signal({ subjectType: "procurement", subjectKey: "cvpis:1" }),
            signal({ subjectType: "lot", subjectKey: "cvpis:1:1" }),
            signal({ subjectType: "bid", subjectKey: "cvpis:1:1:B1" }),
        ];
        await withTransaction((client) => writeDecisions(client, runId, [decisions({ signals: mixedSignals })]));

        const [row] = await decisionsFor("cvpis", "1");
        expect(row.signals).toHaveLength(3);
        expect(row.signals.map((s: RiskSignal) => s.subjectType).sort()).toEqual(["bid", "lot", "procurement"]);
    });

    it("rejects two procurements with the same natural key in one call", async () => {
        const runId = await openRun();
        await expect(
            withTransaction((client) =>
                writeDecisions(client, runId, [decisions({ procurementId: "1" }), decisions({ procurementId: "1" })]),
            ),
        ).rejects.toThrow(/risk_procurement_decisions_natural_key|duplicate key|ON CONFLICT/);
    });
});

describe("risk.v_latest_run", () => {
    it("is the newest completed run, ignoring one still running", async () => {
        const older = await openRun();
        const newer = await openRun();
        await riskDb.query(
            `INSERT INTO risk.risk_evaluation_runs (data_as_of, code_commit, status) VALUES (now(), 'test', 'running')`,
        );

        const { rows } = await riskDb.query<{ id: string }>(`SELECT id FROM risk.v_latest_run`);
        expect(rows[0].id).toBe(String(newer));
        expect(rows[0].id).not.toBe(String(older));
    });
});

describe("risk.v_procurement_summaries", () => {
    it("computes per-procurement counts from that row's own signals", async () => {
        const runId = await openRun();
        await withTransaction((client) =>
            writeDecisions(client, runId, [
                decisions({
                    procurementId: "1",
                    signals: [
                        signal({ state: "triggered", indicatorId: "LT-WRITE-TEST-01" }),
                        signal({ state: "not_triggered", indicatorId: "LT-WRITE-TEST-02" }),
                        signal({ state: "insufficient_data", indicatorId: "LT-WRITE-TEST-03" }),
                    ],
                }),
            ]),
        );

        const { rows } = await riskDb.query(
            `SELECT * FROM risk.v_procurement_summaries WHERE procurement_source = 'cvpis' AND procurement_id = '1'`,
        );
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].triggered_count)).toBe(1);
        expect(Number(rows[0].insufficient_data_count)).toBe(1);
        expect(Number(rows[0].evaluated_count)).toBe(3);
        expect(rows[0].triggered_indicators).toEqual(["LT-WRITE-TEST-01"]);
    });
});
