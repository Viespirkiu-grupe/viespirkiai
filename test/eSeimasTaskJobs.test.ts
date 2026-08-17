import { beforeEach, describe, expect, it, vi } from "vitest";
import { createESeimasTaskJobs } from "../modules/eSeimas/eSeimasTaskJobs.js";

function makeRuntime() {
    const scraper = {
        scrapeDay: vi.fn(async () => ({ seen: 0, discovered: 0 })),
        scrapeDocument: vi.fn(async () => {}),
        scrapeEditionList: vi.fn(async () => {}),
        scrapeConsolidated: vi.fn(async () => {}),
        scrapeHistoricalEdition: vi.fn(async () => {}),
        concurrency: 6,
    };
    const queue = {
        enqueuePending: vi.fn(async (_kind: string) => 0),
        claimNext: vi.fn(async (kind: string) => ({
            queueId: `${kind}-1`,
            kind,
            category: "TAD",
            legalActId: "ABC",
            editionToken: kind === "historical" ? "edition-7" : "",
            claimToken: "claim-1",
        })),
        complete: vi.fn(async () => true),
        fail: vi.fn(async () => true),
    };
    const recentDaysStore = {
        ensure: vi.fn(async () => 0),
        pick: vi.fn(async () => "2026-08-11"),
    };
    const createScraper = vi.fn(() => scraper);
    const jobs = createESeimasTaskJobs({
        recentDays: 180,
        refreshHours: 3,
        createScraper,
        queue,
        recentDaysStore,
    });
    return { jobs, scraper, queue, recentDaysStore, createScraper };
}

describe("eSeimasTaskJobs", () => {
    beforeEach(() => vi.clearAllMocks());

    it("radaras apdoroja vieną pasenusią dieną ir runtime sukuria tingiai", async () => {
        const runtime = makeRuntime();

        await expect(runtime.jobs.scrapeRecentDay()).resolves.toBe(true);

        expect(runtime.recentDaysStore.ensure).toHaveBeenCalledWith(180);
        expect(runtime.recentDaysStore.pick).toHaveBeenCalledWith({ days: 180, refreshHours: 3 });
        expect(runtime.scraper.scrapeDay).toHaveBeenCalledWith("2026-08-11");
        expect(runtime.createScraper).toHaveBeenCalledOnce();
    });

    it("šviežiam radaro langui grąžina false ir neatidaro sidecar", async () => {
        const runtime = makeRuntime();
        runtime.recentDaysStore.pick.mockResolvedValueOnce(null as never);

        await expect(runtime.jobs.scrapeRecentDay()).resolves.toBe(false);

        expect(runtime.scraper.scrapeDay).not.toHaveBeenCalled();
        expect(runtime.createScraper).not.toHaveBeenCalled();
    });

    it("atskirus etapus nukreipia į atskirus scraper metodus", async () => {
        const runtime = makeRuntime();

        await Promise.all([
            runtime.jobs.scrapeDocument(),
            runtime.jobs.scrapeEditionList(),
            runtime.jobs.scrapeAsr(),
            runtime.jobs.scrapeHistorical(),
        ]);

        expect(runtime.queue.enqueuePending.mock.calls.map(([kind]) => kind)).toEqual([
            "document", "editions", "asr", "historical",
        ]);
        expect(runtime.scraper.scrapeDocument).toHaveBeenCalledWith("TAD", "ABC");
        expect(runtime.scraper.scrapeEditionList).toHaveBeenCalledWith("TAD", "ABC");
        expect(runtime.scraper.scrapeConsolidated).toHaveBeenCalledWith("TAD", "ABC");
        expect(runtime.scraper.scrapeHistoricalEdition).toHaveBeenCalledWith({
            category: "TAD",
            legalActId: "ABC",
            editionToken: "edition-7",
        });
        expect(runtime.queue.complete).toHaveBeenCalledTimes(4);
    });

    it("tuščiai konkretaus etapo eilei grąžina false", async () => {
        const runtime = makeRuntime();
        runtime.queue.claimNext.mockResolvedValueOnce(null as never);

        await expect(runtime.jobs.scrapeDocument()).resolves.toBe(false);

        expect(runtime.scraper.scrapeDocument).not.toHaveBeenCalled();
        expect(runtime.queue.complete).not.toHaveBeenCalled();
    });

    it("scraper klaidą įrašo tik į paimto etapo eilės elementą", async () => {
        const runtime = makeRuntime();
        const error = new Error("e-TAR 502");
        runtime.scraper.scrapeConsolidated.mockRejectedValueOnce(error);

        await expect(runtime.jobs.scrapeAsr()).rejects.toThrow("e-TAR 502");

        expect(runtime.queue.fail).toHaveBeenCalledWith(
            expect.objectContaining({ kind: "asr", category: "TAD", legalActId: "ABC" }),
            error,
        );
        expect(runtime.queue.complete).not.toHaveBeenCalled();
    });
});
