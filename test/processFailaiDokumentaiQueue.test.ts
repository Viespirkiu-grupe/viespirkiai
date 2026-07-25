import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    fetchFailaiByIds: vi.fn(),
    upsertBatch: vi.fn(),
    deleteDokumentaiByFailasIds: vi.fn(),
    client: {
        query: vi.fn(),
        release: vi.fn(),
    },
}));

vi.mock("../postgres/postgres.js", () => ({
    postgres: { connect: vi.fn(async () => mocks.client) },
}));

vi.mock("../utils/log.js", () => ({
    Logger: class { log() {} },
}));

vi.mock("../modules/dokumentai/upsertFromFailai.js", () => ({
    fetchFailaiByIds: mocks.fetchFailaiByIds,
    upsertBatch: mocks.upsertBatch,
    deleteDokumentaiByFailasIds: mocks.deleteDokumentaiByFailasIds,
}));

import { processFailaiDokumentaiQueue } from "../modules/dokumentai/processFailaiDokumentaiQueue.js";

describe("processFailaiDokumentaiQueue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.client.query.mockImplementation(async (sql: string) => {
            if (sql.includes('FROM public."filesDocumentsQueue"')) {
                return { rows: [{ id: "91", failoId: 42, keitimas: "insert" }] };
            }
            return { rows: [] };
        });
        mocks.fetchFailaiByIds.mockResolvedValue([{ id: 42 }]);
        mocks.upsertBatch.mockResolvedValue({ inserted: 1, skipped: 0 });
    });

    it("deletes claimed rows only after processing succeeds", async () => {
        await expect(processFailaiDokumentaiQueue()).resolves.toBe(true);

        expect(mocks.fetchFailaiByIds).toHaveBeenCalledWith([42], mocks.client);
        expect(mocks.upsertBatch).toHaveBeenCalledWith([{ id: 42 }], mocks.client);
        const sqlCalls = mocks.client.query.mock.calls.map(([sql]) => String(sql));
        const deleteAt = sqlCalls.findIndex((sql) => sql.includes('DELETE FROM public."filesDocumentsQueue"'));
        const commitAt = sqlCalls.indexOf("COMMIT");
        expect(deleteAt).toBeGreaterThan(0);
        expect(commitAt).toBeGreaterThan(deleteAt);
        expect(mocks.client.release).toHaveBeenCalledOnce();
    });

    it("rolls back and retains claimed rows when processing fails", async () => {
        mocks.fetchFailaiByIds.mockRejectedValue(new Error("invalid source id"));

        await expect(processFailaiDokumentaiQueue()).rejects.toThrow("invalid source id");

        const sqlCalls = mocks.client.query.mock.calls.map(([sql]) => String(sql));
        expect(sqlCalls).toContain("ROLLBACK");
        expect(sqlCalls.some((sql) => sql.includes('DELETE FROM public."filesDocumentsQueue"'))).toBe(false);
        expect(mocks.client.release).toHaveBeenCalledOnce();
    });
});
