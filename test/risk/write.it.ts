// Integration tests for the Risk Signals Writer (services/procurement-risk/
// write.ts) and the retention job, against the local risk-dev Postgres.
// Protects the storage decision docs/indicators-story/risk-service-
// architecture.md §6.2 depends on: risk_signals is insert-only, one run is one
// immutable snapshot, the site reads exactly one run, and superseded snapshots
// are deleted whole.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { riskDb } from "../../postgres/riskDb.js";
import { writeObservations } from "../../services/procurement-risk/write.ts";
import { deleteExpiredSnapshots } from "../../services/procurement-risk/retention.ts";
import type { RiskSignal } from "../../modules/risk/types.ts";

const INDICATOR_ID = "LT-WRITE-TEST-01";

function observation(overrides: Partial<RiskSignal> = {}): RiskSignal {
    return {
        indicatorId: INDICATOR_ID,
        indicatorVersion: 1,
        subjectType: "procurement",
        subjectKey: "cvpis:1",
        procurementSource: "cvpis",
        procurementId: "1",
        state: "triggered",
        rawValue: { a: 1 },
        threshold: { a: 1 },
        appliedParameters: { a: 1 },
        evidence: { a: 1 },
        missingData: [],
        dataAsOf: "2026-08-12T00:00:00.000Z",
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

async function signalsOfRun(runId: number) {
    const { rows } = await riskDb.query(
        `SELECT * FROM risk.risk_signals WHERE run_id = $1 ORDER BY subject_key`,
        [runId],
    );
    return rows;
}

async function allTestSignals() {
    const { rows } = await riskDb.query(
        `SELECT * FROM risk.risk_signals WHERE indicator_id = $1 ORDER BY run_id, subject_key`,
        [INDICATOR_ID],
    );
    return rows;
}

// These tests don't exercise the run open/close lifecycle, so runs are
// inserted pre-closed to avoid colliding with the partial unique index on
// status = 'running'. `startedAt` lets a run be aged for the retention tests.
async function openRun(startedAt = "now()"): Promise<number> {
    const { rows } = await riskDb.query<{ id: number }>(
        `INSERT INTO risk.evaluation_runs (data_as_of, code_commit, status, started_at)
         VALUES (now(), 'test', 'succeeded', ${startedAt === "now()" ? "now()" : "$1::timestamptz"})
         RETURNING id`,
        startedAt === "now()" ? [] : [startedAt],
    );
    return rows[0].id;
}

// Clears the whole sandbox schema, not just this file's rows: `v_latest_run`
// is a property of the runs table as a whole, so a leftover run from a manual
// `npm run risk:run` would otherwise decide which snapshot these tests see.
// The DELETE grant on risk.evaluation_runs that makes this possible is
// test-only — see migrations/risk/test/000_grants.sql; nothing may delete a
// run in production.
async function cleanUp(): Promise<void> {
    await riskDb.query(`DELETE FROM risk.risk_signals`);
    await riskDb.query(`DELETE FROM risk.evaluation_runs`);
}

beforeAll(cleanUp);
afterEach(cleanUp);
afterAll(async () => {
    await riskDb.end();
});

describe("Risk Signals Writer", () => {
    it("appends the observations of one indicator to the run's snapshot", async () => {
        const runId = await openRun();
        const stats = await withTransaction((client) =>
            writeObservations(client, runId, [
                observation({ subjectKey: "cvpis:1" }),
                observation({ subjectKey: "cvpis:2" }),
            ]),
        );
        expect(stats).toEqual({ inserted: 2 });

        const rows = await signalsOfRun(runId);
        expect(rows).toHaveLength(2);
        expect(rows[0].run_id).toBe(String(runId));
        expect(rows[0].state).toBe("triggered");
    });

    it("writes nothing for an indicator that produced no observations", async () => {
        const runId = await openRun();
        const stats = await withTransaction((client) => writeObservations(client, runId, []));
        expect(stats).toEqual({ inserted: 0 });
        expect(await signalsOfRun(runId)).toHaveLength(0);
    });

    // The point of the model: an unchanged result is written again rather than
    // compared, so each run's snapshot stands alone.
    it("keeps each run's rows separate, leaving the previous snapshot untouched", async () => {
        const runId1 = await openRun();
        await withTransaction((client) => writeObservations(client, runId1, [observation()]));
        const first = await signalsOfRun(runId1);

        const runId2 = await openRun();
        await withTransaction((client) =>
            writeObservations(client, runId2, [observation({ state: "not_triggered" })]),
        );

        expect(await signalsOfRun(runId1)).toEqual(first);
        expect((await signalsOfRun(runId2))[0].state).toBe("not_triggered");
        expect(await allTestSignals()).toHaveLength(2);
    });

    it("rejects two results for the same subject and indicator within one run", async () => {
        const runId = await openRun();
        await expect(
            withTransaction((client) =>
                writeObservations(client, runId, [observation(), observation()]),
            ),
        ).rejects.toThrow(/risk_signals_run_subject_idx|duplicate key/);
    });

    it("contains a failing indicator: its rows are absent, others' remain", async () => {
        const runId = await openRun();
        await withTransaction((client) => writeObservations(client, runId, [observation()]));

        await expect(
            withTransaction(async (client) => {
                await writeObservations(client, runId, [
                    observation({ indicatorId: "LT-WRITE-TEST-02" }),
                ]);
                throw new Error("indicator failed after writing");
            }),
        ).rejects.toThrow(/indicator failed/);

        const rows = await signalsOfRun(runId);
        expect(rows.map((r) => r.indicator_id)).toEqual([INDICATOR_ID]);
    });
});

describe("risk.v_latest_run", () => {
    it("is the newest completed run, ignoring one still running", async () => {
        const older = await openRun("2026-01-01T00:00:00Z");
        const newer = await openRun();
        await riskDb.query(
            `INSERT INTO risk.evaluation_runs (data_as_of, code_commit, status) VALUES (now(), 'test', 'running')`,
        );

        const { rows } = await riskDb.query<{ id: string }>(`SELECT id FROM risk.v_latest_run`);
        expect(rows[0].id).toBe(String(newer));
        expect(rows[0].id).not.toBe(String(older));
    });
});

describe("retention", () => {
    it("deletes the signals of a superseded run past the window", async () => {
        const old = await openRun("2026-01-01T00:00:00Z");
        await withTransaction((client) => writeObservations(client, old, [observation()]));
        const current = await openRun();
        await withTransaction((client) => writeObservations(client, current, [observation()]));

        const stats = await withTransaction(deleteExpiredSnapshots);

        expect(stats).toEqual({ runsCleared: 1, signalsDeleted: 1 });
        expect(await signalsOfRun(old)).toHaveLength(0);
        expect(await signalsOfRun(current)).toHaveLength(1);
    });

    // The safety belt: after a long outage the newest successful run is itself
    // past the window, and emptying the public pages would be worse than
    // serving stale ones.
    it("never deletes the run the site is showing, however old it is", async () => {
        const onlyRun = await openRun("2026-01-01T00:00:00Z");
        await withTransaction((client) => writeObservations(client, onlyRun, [observation()]));

        const stats = await withTransaction(deleteExpiredSnapshots);

        expect(stats).toEqual({ runsCleared: 0, signalsDeleted: 0 });
        expect(await signalsOfRun(onlyRun)).toHaveLength(1);
    });

    it("keeps the run rows themselves, as the provenance of past signals", async () => {
        const old = await openRun("2026-01-01T00:00:00Z");
        await withTransaction((client) => writeObservations(client, old, [observation()]));
        await openRun();

        await withTransaction(deleteExpiredSnapshots);

        const { rows } = await riskDb.query(`SELECT id FROM risk.evaluation_runs WHERE id = $1`, [old]);
        expect(rows).toHaveLength(1);
    });
});
