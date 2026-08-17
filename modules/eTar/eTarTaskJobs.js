import { createETarApi } from "./eTarApi.js";
import { createRunner } from "./eTarScrape.js";
import { openETarSidecar } from "./eTarSidecar.js";
import {
    claimNextETarJob,
    completeETarJob,
    enqueuePendingETarJobs,
    failETarJob,
} from "./eTarTaskQueue.js";
import { ensureRecentScrapeDays, pickRecentDayToScrape } from "./eTarStore.js";

const DEFAULT_RECENT_DAYS = 180;
const DEFAULT_REFRESH_HOURS = 3;
const DEFAULT_MAX_INFLIGHT = 6;

/**
 * Vienas bendras runtime visiems e-TAR TaskRunner darbams: API srauto
 * ribotuvas ir SQLite writeris negali būti kuriami atskirai kiekvienam etapui.
 */
export function createETarTaskJobs({
    recentDays = DEFAULT_RECENT_DAYS,
    refreshHours = DEFAULT_REFRESH_HOURS,
    maxInflight = DEFAULT_MAX_INFLIGHT,
    createScraper = () => createRunner({
        api: createETarApi({ maxInflight }),
        sidecar: openETarSidecar(),
        concurrency: maxInflight,
    }),
    queue = {
        enqueuePending: enqueuePendingETarJobs,
        claimNext: claimNextETarJob,
        complete: completeETarJob,
        fail: failETarJob,
    },
    recentDaysStore = {
        ensure: ensureRecentScrapeDays,
        pick: pickRecentDayToScrape,
    },
} = {}) {
    let scraper = null;
    const getScraper = () => scraper ??= createScraper();

    async function runClaimed(kind, work) {
        await queue.enqueuePending(kind);
        const job = await queue.claimNext(kind);
        if (!job) return false;

        try {
            await work(getScraper(), job);
            await queue.complete(job);
            return true;
        } catch (error) {
            try {
                await queue.fail(job, error);
            } catch (queueError) {
                console.error(`[e-TAR ${kind}] nepavyko grąžinti darbo į eilę:`, queueError);
            }
            throw error;
        }
    }

    return {
        /** Viena diena, tačiau visi tos dienos paieškos puslapiai. */
        async scrapeRecentDay() {
            await recentDaysStore.ensure(recentDays);
            const day = await recentDaysStore.pick({ days: recentDays, refreshHours });
            if (!day) return false;
            await getScraper().scrapeDay(day);
            return true;
        },

        scrapeDocument() {
            return runClaimed("document", (runner, job) =>
                runner.scrapeDocument(job.legalActId));
        },

        scrapeEditionList() {
            return runClaimed("editions", (runner, job) =>
                runner.scrapeEditionList(job.legalActId));
        },

        scrapeAsr() {
            return runClaimed("asr", (runner, job) =>
                runner.scrapeConsolidated(job.legalActId));
        },

        scrapeHistorical() {
            return runClaimed("historical", (runner, job) =>
                runner.scrapeHistoricalEdition({
                    legalActId: job.legalActId,
                    editionToken: job.editionToken,
                }));
        },
    };
}
