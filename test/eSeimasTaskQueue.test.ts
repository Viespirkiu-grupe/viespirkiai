import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../postgres/postgres.js", () => ({
    postgres: { query: mocks.query },
}));

import {
    claimNextESeimasJob,
    completeESeimasJob,
    enqueuePendingESeimasJobs,
    failESeimasJob,
} from "../modules/eSeimas/eSeimasTaskQueue.js";

describe("eSeimasTaskQueue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    });

    it("papildo kiekvieno etapo eilę iš jo progreso žymos", async () => {
        mocks.query.mockResolvedValue({ rows: [], rowCount: 3 });

        await expect(enqueuePendingESeimasJobs("editions", { limit: 25 })).resolves.toBe(3);

        const [sql, params] = mocks.query.mock.calls[0];
        expect(sql).toContain('s."editionsScrapedAt" IS NULL');
        expect(sql).toContain('INSERT INTO "eSeimas"."scrapeQueue"');
        expect(sql).toContain('s."category"');
        expect(sql).toContain('ON CONFLICT (kind, "category", "legalActId", "editionToken")');
        expect(params).toEqual(["editions", 25]);
    });

    it("istorinei redakcijai naudoja editionToken", async () => {
        await enqueuePendingESeimasJobs("historical");

        const [sql] = mocks.query.mock.calls[0];
        expect(sql).toContain('FROM "eSeimas"."edition" s');
        expect(sql).toContain('s."editionToken"');
        expect(sql).toContain('s."scrapedAt" IS NULL');
    });

    it("atominiu UPDATE pasiima darbą su lease ir claim token", async () => {
        mocks.query.mockResolvedValue({
            rows: [{ queueId: "7", kind: "document", category: "TAD", legalActId: "ABC", claimToken: "claim-1" }],
            rowCount: 1,
        });

        await expect(claimNextESeimasJob("document", {
            claimToken: "claim-1",
            leaseMinutes: 90,
        })).resolves.toMatchObject({ queueId: "7", category: "TAD", legalActId: "ABC" });

        const [sql, params] = mocks.query.mock.calls[0];
        expect(sql).toContain("FOR UPDATE SKIP LOCKED");
        expect(sql).toContain('SET "claimToken" = $3');
        expect(params).toEqual(["document", 5, "claim-1", 90]);
    });

    it("užbaigia ir grąžina klaidingą darbą tik su to lease claim token", async () => {
        mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
        const job = { queueId: "7", claimToken: "claim-1" };

        await expect(completeESeimasJob(job)).resolves.toBe(true);
        expect(mocks.query.mock.calls[0][1]).toEqual(["7", "claim-1"]);

        await expect(failESeimasJob(job, new Error("adapteris nulūžo"))).resolves.toBe(true);
        const [sql, params] = mocks.query.mock.calls[1];
        expect(sql).toContain('"failureCount" = "failureCount" + 1');
        expect(sql).toContain('"claimToken" = NULL');
        expect(params).toEqual(["7", "claim-1", "adapteris nulūžo", 30]);
    });

    it("atmeta nežinomą etapą prieš kreipdamasis į DB", async () => {
        await expect(enqueuePendingESeimasJobs("unknown" as never)).rejects.toThrow("Nežinoma");
        expect(mocks.query).not.toHaveBeenCalled();
    });
});
