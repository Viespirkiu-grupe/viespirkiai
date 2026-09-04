// Integration tests for the Decision Writer (services/procurement-risk/
// write.ts), against a local database's `risk` schema. Protects the storage
// decision docs/indicators-story/risk-service-architecture.md §2.4 depends
// on: risk."procurementDecisions" is current-state, one row per procurement,
// refreshed in place by INSERT ... ON CONFLICT DO UPDATE; risk."signals" is its
// own table, wiped and reinserted per procurement via "decisionId".
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { PoolClient } from "pg";
import config from "../../utils/config.js";
import { postgres } from "../../postgres/postgres.js";
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
        ...overrides,
    };
}

function decisions(overrides: Partial<ProcurementRiskDecisions> = {}): ProcurementRiskDecisions {
    const now = new Date();
    return {
        procurementSource: "cvpis",
        procurementId: "1",
        signals: [signal()],
        dataAsOf: "2026-08-12T00:00:00.000Z",
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await postgres.connect();
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
    const { rows } = await postgres.query(
        `SELECT * FROM risk."procurementDecisions" WHERE "procurementSource" = $1 AND "procurementId" = $2`,
        [procurementSource, procurementId],
    );
    return rows;
}

async function signalsFor(procurementSource: string, procurementId: string) {
    const { rows } = await postgres.query(
        `SELECT s.* FROM risk."signals" s
           JOIN risk."procurementDecisions" d ON d."id" = s."decisionId"
          WHERE d."procurementSource" = $1 AND d."procurementId" = $2`,
        [procurementSource, procurementId],
    );
    return rows;
}

// Clears every decisions row, not just this file's: the fixtures reuse a
// fixed natural key, so a leftover row from a manual `npm run risk:run` would
// otherwise decide what these tests see. That makes this suite destructive to
// any real risk output in the target database — assertLocalDb() keeps it on a
// local one. Nothing deletes a "procurementDecisions" row in production; rows
// are only ever overwritten. risk."signals" rows cascade away with their
// parent decisions row (ON DELETE CASCADE), matching production's own
// per-procurement DELETE.
function assertLocalDb(): void {
    if (config.pgHost !== "localhost" && config.pgHost !== "127.0.0.1") {
        throw new Error(
            `refusing to run: pgHost must be a local database, got ${JSON.stringify(config.pgHost)}. ` +
                'This suite DELETEs every risk."procurementDecisions" row.',
        );
    }
}

async function cleanUp(): Promise<void> {
    assertLocalDb();
    await postgres.query(`DELETE FROM risk."procurementDecisions"`);
}

beforeAll(cleanUp);
afterEach(cleanUp);
afterAll(async () => {
    await postgres.end();
});

describe("Decision Writer", () => {
    it("inserts one row per procurement", async () => {
        const stats = await withTransaction((client) =>
            writeDecisions(client, [
                decisions({ procurementId: "1" }),
                decisions({ procurementId: "2" }),
            ]),
        );
        expect(stats).toEqual({ written: 2 });

        expect(await decisionsFor("cvpis", "1")).toHaveLength(1);
        expect(await decisionsFor("cvpis", "2")).toHaveLength(1);
        expect(await signalsFor("cvpis", "1")).toHaveLength(1);
        expect(await signalsFor("cvpis", "2")).toHaveLength(1);
    });

    it("writes nothing for an empty page", async () => {
        const stats = await withTransaction((client) => writeDecisions(client, []));
        expect(stats).toEqual({ written: 0 });
    });

    // The point of the model: a later run refreshes the same procurement's row
    // in place rather than appending a new one.
    it('refreshes an existing procurement\'s row in place, keeping "createdAt" and advancing "updatedAt"', async () => {
        await withTransaction((client) => writeDecisions(client, [decisions({ signals: [signal({ state: "triggered" })] })]));
        const [first] = await decisionsFor("cvpis", "1");

        await withTransaction((client) =>
            writeDecisions(client, [decisions({ signals: [signal({ state: "not_triggered" })] })]),
        );
        const rows = await decisionsFor("cvpis", "1");
        const signals = await signalsFor("cvpis", "1");

        expect(rows).toHaveLength(1);
        expect(signals).toHaveLength(1);
        expect(signals[0].state).toBe("not_triggered");
        expect(rows[0].createdAt).toEqual(first.createdAt);
        expect(new Date(rows[0].updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(first.updatedAt).getTime());
    });

    it('holds every signal for a procurement (procurement, lot and bid grains) as separate risk."signals" rows', async () => {
        const mixedSignals = [
            signal({ subjectType: "procurement", subjectKey: "cvpis:1" }),
            signal({ subjectType: "lot", subjectKey: "cvpis:1:1" }),
            signal({ subjectType: "bid", subjectKey: "cvpis:1:1:B1" }),
        ];
        await withTransaction((client) => writeDecisions(client, [decisions({ signals: mixedSignals })]));

        const rows = await signalsFor("cvpis", "1");
        expect(rows).toHaveLength(3);
        expect(rows.map((s) => s.subjectType).sort()).toEqual(["bid", "lot", "procurement"]);
    });

    it("wipes and reinserts a procurement's signals on refresh, never updating in place", async () => {
        await withTransaction((client) =>
            writeDecisions(client, [
                decisions({
                    signals: [
                        signal({ indicatorId: "LT-WRITE-TEST-01", state: "triggered" }),
                        signal({ indicatorId: "LT-WRITE-TEST-02", state: "triggered" }),
                    ],
                }),
            ]),
        );
        expect(await signalsFor("cvpis", "1")).toHaveLength(2);

        await withTransaction((client) =>
            writeDecisions(client, [decisions({ signals: [signal({ indicatorId: "LT-WRITE-TEST-03", state: "not_triggered" })] })]),
        );
        const rows = await signalsFor("cvpis", "1");
        expect(rows).toHaveLength(1);
        expect(rows[0].indicatorId).toBe("LT-WRITE-TEST-03");
    });

    it("rejects two procurements with the same natural key in one call", async () => {
        await expect(
            withTransaction((client) =>
                writeDecisions(client, [decisions({ procurementId: "1" }), decisions({ procurementId: "1" })]),
            ),
        ).rejects.toThrow(/procurementDecisionsNaturalKey|duplicate key|ON CONFLICT/);
    });
});

describe('risk."vProcurementSummaries"', () => {
    it('computes per-procurement counts from that row\'s risk."signals"', async () => {
        await withTransaction((client) =>
            writeDecisions(client, [
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

        const { rows } = await postgres.query(
            `SELECT * FROM risk."vProcurementSummaries" WHERE "procurementSource" = 'cvpis' AND "procurementId" = '1'`,
        );
        expect(rows).toHaveLength(1);
        expect(Number(rows[0].triggeredCount)).toBe(1);
        expect(Number(rows[0].insufficientDataCount)).toBe(1);
        expect(Number(rows[0].evaluatedCount)).toBe(3);
        expect(rows[0].triggeredIndicators).toEqual(["LT-WRITE-TEST-01"]);
    });
});
