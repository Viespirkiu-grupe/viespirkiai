import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock("../postgres/postgres.js", () => ({
    postgres: { query: mocks.query },
}));

import {
    claimNextETarJob,
    completeETarJob,
    enqueuePendingETarJobs,
    failETarJob,
} from "../modules/eTar/eTarTaskQueue.js";

describe("eTarTaskQueue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
    });

    it("papildo kiekvieno etapo eilę iš jo progreso žymos", async () => {
        mocks.query.mockResolvedValue({ rows: [], rowCount: 3 });

        await expect(enqueuePendingETarJobs("editions", { limit: 25 })).resolves.toBe(3);

        const [sql, params] = mocks.query.mock.calls[0];
        expect(sql).toContain('s."editionsScrapedAt" IS NULL');
        expect(sql).toContain('INSERT INTO public."eTarScrapeQueue"');
        expect(params).toEqual(["editions", 25]);
    });

    it("istorinei redakcijai naudoja editionToken", async () => {
        await enqueuePendingETarJobs("historical");

        const [sql] = mocks.query.mock.calls[0];
        expect(sql).toContain('FROM public."eTarEdition" s');
        expect(sql).toContain('s."editionToken"');
        expect(sql).toContain('s."scrapedAt" IS NULL');
    });

    it("atominiu UPDATE pasiima darbą su lease ir claim token", async () => {
        mocks.query.mockResolvedValue({
            rows: [{ queueId: "7", kind: "document", legalActId: "TAR.X", claimToken: "claim-1" }],
            rowCount: 1,
        });

        await expect(claimNextETarJob("document", {
            claimToken: "claim-1",
            leaseMinutes: 90,
        })).resolves.toMatchObject({ queueId: "7", legalActId: "TAR.X" });

        const [sql, params] = mocks.query.mock.calls[0];
        expect(sql).toContain("FOR UPDATE SKIP LOCKED");
        expect(sql).toContain('SET "claimToken" = $3');
        expect(params).toEqual(["document", 5, "claim-1", 90]);
    });

    it("užbaigia ir grąžina klaidingą darbą tik su to lease claim token", async () => {
        mocks.query.mockResolvedValue({ rows: [], rowCount: 1 });
        const job = { queueId: "7", claimToken: "claim-1" };

        await expect(completeETarJob(job)).resolves.toBe(true);
        expect(mocks.query.mock.calls[0][1]).toEqual(["7", "claim-1"]);

        await expect(failETarJob(job, new Error("adapteris nulūžo"))).resolves.toBe(true);
        const [sql, params] = mocks.query.mock.calls[1];
        expect(sql).toContain('"failureCount" = "failureCount" + 1');
        expect(sql).toContain('"claimToken" = NULL');
        expect(params).toEqual(["7", "claim-1", "adapteris nulūžo", 30]);
    });

    it("atmeta nežinomą etapą prieš kreipdamasis į DB", async () => {
        await expect(enqueuePendingETarJobs("unknown" as never)).rejects.toThrow("Nežinoma");
        expect(mocks.query).not.toHaveBeenCalled();
    });
});
