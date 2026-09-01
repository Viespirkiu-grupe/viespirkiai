import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    fetchFailaiByIds: vi.fn(),
    upsertBatch: vi.fn(),
    deleteDocumentsByFileIds: vi.fn(),
    signalWork: vi.fn(),
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
vi.mock("../utils/taskSignals.js", () => ({
    WORK_SIGNALS: { DOCUMENTS_INDEX_READY: "documents.index.ready" },
    signalWork: mocks.signalWork,
}));

vi.mock("../modules/documents/upsertFromFiles.js", () => ({
    fetchFailaiByIds: mocks.fetchFailaiByIds,
    upsertBatch: mocks.upsertBatch,
    deleteDocumentsByFileIds: mocks.deleteDocumentsByFileIds,
}));

import { processFilesDocumentsQueue } from "../modules/documents/processFilesQueue.js";

describe("processFilesDocumentsQueue", () => {
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
        await expect(processFilesDocumentsQueue()).resolves.toBe(true);

        expect(mocks.fetchFailaiByIds).toHaveBeenCalledWith([42], mocks.client);
        expect(mocks.upsertBatch).toHaveBeenCalledWith([{ id: 42 }], mocks.client);
        const sqlCalls = mocks.client.query.mock.calls.map(([sql]) => String(sql));
        const deleteAt = sqlCalls.findIndex((sql) => sql.includes('DELETE FROM public."filesDocumentsQueue"'));
        const commitAt = sqlCalls.indexOf("COMMIT");
        expect(deleteAt).toBeGreaterThan(0);
        expect(commitAt).toBeGreaterThan(deleteAt);
        expect(mocks.signalWork).toHaveBeenCalledWith("documents.index.ready", {
            source: "filesDocumentsQueue",
            count: 1,
        });
        expect(mocks.signalWork.mock.invocationCallOrder[0])
            .toBeGreaterThan(mocks.client.query.mock.invocationCallOrder[commitAt]);
        expect(mocks.client.release).toHaveBeenCalledOnce();
    });

    it("rolls back and retains claimed rows when processing fails", async () => {
        mocks.fetchFailaiByIds.mockRejectedValue(new Error("invalid source id"));

        await expect(processFilesDocumentsQueue()).rejects.toThrow("invalid source id");

        const sqlCalls = mocks.client.query.mock.calls.map(([sql]) => String(sql));
        expect(sqlCalls).toContain("ROLLBACK");
        expect(sqlCalls.some((sql) => sql.includes('DELETE FROM public."filesDocumentsQueue"'))).toBe(false);
        expect(mocks.signalWork).not.toHaveBeenCalled();
        expect(mocks.client.release).toHaveBeenCalledOnce();
    });
});
