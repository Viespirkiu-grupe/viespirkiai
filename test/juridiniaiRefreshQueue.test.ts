import { describe, expect, it, vi } from "vitest";

const signals = vi.hoisted(() => ({ signalWork: vi.fn() }));
vi.mock("../utils/taskSignals.js", () => ({
    WORK_SIGNALS: { JURIDINIAI_INDEX_READY: "index-ready" },
    signalWork: signals.signalWork,
}));

import {
    processJuridiniaiRefreshQueue,
    REFRESH_BATCH_SQL,
} from "../modules/juridiniai/processRefreshQueue.js";

describe("juridiniai refresh queue", () => {
    it("reuses the full projection for only claimed JAR codes", () => {
        expect(REFRESH_BATCH_SQL).toContain('= ANY($1::integer[])');
        expect(REFRESH_BATCH_SQL).toContain('INSERT INTO juridiniai."juridiniai"');
        expect(REFRESH_BATCH_SQL).toContain("IS DISTINCT FROM");
    });

    it("locks, projects and removes one queue batch atomically", async () => {
        const queries: string[] = [];
        const client = {
            query: vi.fn(async (sql: string) => {
                queries.push(sql.replace(/\s+/g, " ").trim());
                if (sql.includes("pg_try_advisory_xact_lock")) {
                    return { rows: [{ locked: true }] };
                }
                if (sql.includes("FOR UPDATE SKIP LOCKED")) {
                    return { rows: [{ jarKodas: 123456789 }] };
                }
                if (sql === REFRESH_BATCH_SQL) return { rows: [{ changed: 1 }] };
                if (sql.includes('DELETE FROM juridiniai."juridiniai" j')) {
                    return { rows: [], rowCount: 0 };
                }
                return { rows: [], rowCount: 1 };
            }),
            release: vi.fn(),
        };
        const db = { connect: vi.fn(async () => client) };

        const onProgress = vi.fn();
        await expect(processJuridiniaiRefreshQueue(
            { onProgress },
            db as never,
        )).resolves.toBe(true);
        expect(queries[0]).toBe("BEGIN");
        expect(queries.some((sql) => sql.includes("FOR UPDATE SKIP LOCKED"))).toBe(true);
        expect(queries.at(-1)).toBe("COMMIT");
        expect(client.release).toHaveBeenCalled();
        expect(onProgress).toHaveBeenNthCalledWith(1, {
            stage: "claimed",
            count: 1,
        });
        expect(onProgress).toHaveBeenNthCalledWith(2, {
            stage: "completed",
            count: 1,
            changed: 1,
        });
        expect(signals.signalWork).toHaveBeenCalledWith("index-ready", {
            source: "juridiniai-refresh",
            count: 1,
        });
    });

    it("returns false without projecting when the queue is empty", async () => {
        const client = {
            query: vi.fn(async (sql: string) => ({
                rows: sql.includes("pg_try_advisory_xact_lock")
                    ? [{ locked: true }]
                    : [],
                rowCount: 0,
            })),
            release: vi.fn(),
        };
        const db = { connect: vi.fn(async () => client) };
        await expect(processJuridiniaiRefreshQueue({}, db as never)).resolves.toBe(false);
        expect(client.query).toHaveBeenCalledTimes(4);
    });

    it("does not claim queue rows while a JAR import is running", async () => {
        const queries: string[] = [];
        const client = {
            query: vi.fn(async (sql: string) => {
                queries.push(sql);
                return sql.includes("pg_try_advisory_xact_lock")
                    ? { rows: [{ locked: false }] }
                    : { rows: [] };
            }),
            release: vi.fn(),
        };
        const db = { connect: vi.fn(async () => client) };

        await expect(processJuridiniaiRefreshQueue({}, db as never)).resolves.toBe(false);
        expect(queries.some((sql) => sql.includes("FOR UPDATE SKIP LOCKED"))).toBe(false);
        expect(queries.at(-1)).toBe("COMMIT");
    });
});
