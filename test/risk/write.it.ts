// Integration tests for the Risk Signals Writer (services/procurement-risk/
// write.ts), against the local risk-dev Postgres. Protects the storage
// decision docs/indicators-story/risk-service-architecture.md §7.2 depends
// on: write-on-change, close-and-append with no gap, and idempotent reruns.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import { riskDb } from "../../postgres/riskDb.js";
import { writeObservations } from "../../services/procurement-risk/write.ts";
import type { RiskObservationV1 } from "../../modules/risk/contracts.ts";

const INDICATOR_ID = "LT-WRITE-TEST-01";

function observation(overrides: Partial<RiskObservationV1> = {}): RiskObservationV1 {
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

async function currentRows() {
    const { rows } = await riskDb.query(
        `SELECT * FROM risk.risk_signals WHERE indicator_id = $1 ORDER BY subject_key, valid_from`,
        [INDICATOR_ID],
    );
    return rows;
}

// writeObservations only needs a valid run_id to reference — these tests
// don't exercise run open/close lifecycle, so insert it pre-closed to avoid
// colliding with the partial unique index on status = 'running'.
async function openRun(): Promise<number> {
    const { rows } = await riskDb.query<{ id: number }>(
        `INSERT INTO risk.evaluation_runs (data_as_of, code_commit, status) VALUES (now(), 'test', 'succeeded') RETURNING id`,
    );
    return rows[0].id;
}

describe("Risk Signals Writer", () => {
    beforeAll(async () => {
        await riskDb.query(`DELETE FROM risk.risk_signals WHERE indicator_id = $1`, [INDICATOR_ID]);
    });

    afterEach(async () => {
        await riskDb.query(`DELETE FROM risk.risk_signals WHERE indicator_id = $1`, [INDICATOR_ID]);
        await riskDb.query(`DELETE FROM risk.evaluation_runs WHERE code_commit = 'test'`);
    });

    afterAll(async () => {
        await riskDb.end();
    });

    it("inserts a new current row for a first-seen subject", async () => {
        const runId = await openRun();
        const stats = await withTransaction((client) =>
            writeObservations(client, INDICATOR_ID, runId, [observation()]),
        );
        expect(stats).toEqual({ closed: 1, inserted: 1, unchanged: 0 });

        const rows = await currentRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].valid_to).toBeNull();
        expect(rows[0].state).toBe("triggered");
    });

    it("writes zero new rows and only advances checked_at on an identical rerun", async () => {
        const runId1 = await openRun();
        await withTransaction((client) => writeObservations(client, INDICATOR_ID, runId1, [observation()]));
        const before = await currentRows();

        await new Promise((resolve) => setTimeout(resolve, 10));

        const runId2 = await openRun();
        const stats = await withTransaction((client) =>
            writeObservations(client, INDICATOR_ID, runId2, [observation()]),
        );

        expect(stats).toEqual({ closed: 0, inserted: 0, unchanged: 1 });
        const after = await currentRows();
        expect(after).toHaveLength(1);
        expect(after[0].id).toBe(before[0].id);
        expect(new Date(after[0].checked_at).getTime()).toBeGreaterThan(new Date(before[0].checked_at).getTime());
        expect(after[0].run_id).toBe(String(runId1)); // provenance stays the run that actually produced the result
    });

    it("closes the old row and inserts a new one with no gap when the result changes", async () => {
        const runId1 = await openRun();
        await withTransaction((client) =>
            writeObservations(client, INDICATOR_ID, runId1, [observation({ state: "triggered" })]),
        );

        const runId2 = await openRun();
        const stats = await withTransaction((client) =>
            writeObservations(client, INDICATOR_ID, runId2, [observation({ state: "not_triggered", rawValue: { a: 2 } })]),
        );

        expect(stats).toEqual({ closed: 1, inserted: 1, unchanged: 0 });

        const rows = await currentRows();
        expect(rows).toHaveLength(2);
        const closed = rows.find((r) => r.valid_to !== null)!;
        const current = rows.find((r) => r.valid_to === null)!;
        expect(closed.state).toBe("triggered");
        expect(current.state).toBe("not_triggered");
        expect(closed.valid_to).toStrictEqual(current.valid_from); // no gap, no overlap
    });

    it("treats a NULL appearing on either side as a change (IS DISTINCT FROM)", async () => {
        const runId1 = await openRun();
        await withTransaction((client) =>
            writeObservations(client, INDICATOR_ID, runId1, [observation({ missingData: ["x"] })]),
        );

        const runId2 = await openRun();
        const stats = await withTransaction((client) =>
            writeObservations(client, INDICATOR_ID, runId2, [
                observation({ state: "insufficient_data", rawValue: null, threshold: null, missingData: ["x"] }),
            ]),
        );

        expect(stats.closed).toBe(1);
        expect(stats.inserted).toBe(1);
    });

    it("keeps other subjects' rows untouched when only one subject changes", async () => {
        const runId1 = await openRun();
        await withTransaction((client) =>
            writeObservations(client, INDICATOR_ID, runId1, [
                observation({ subjectKey: "cvpis:1" }),
                observation({ subjectKey: "cvpis:2" }),
            ]),
        );

        const runId2 = await openRun();
        await withTransaction((client) =>
            writeObservations(client, INDICATOR_ID, runId2, [
                observation({ subjectKey: "cvpis:1", state: "not_triggered", rawValue: { a: 2 } }),
                observation({ subjectKey: "cvpis:2" }),
            ]),
        );

        const rows = await currentRows();
        const subject2 = rows.filter((r) => r.subject_key === "cvpis:2");
        expect(subject2).toHaveLength(1);
        expect(subject2[0].run_id).toBe(String(runId1));
    });
});
