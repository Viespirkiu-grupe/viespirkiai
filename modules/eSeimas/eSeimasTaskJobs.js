import { createESeimasApi } from "./eSeimasApi.js";
import { createRunner } from "./eSeimasScrape.js";
import { openESeimasSidecar } from "./eSeimasSidecar.js";
import {
    claimNextESeimasJob,
    completeESeimasJob,
    enqueuePendingESeimasJobs,
    failESeimasJob,
} from "./eSeimasTaskQueue.js";
import { ensureRecentScrapeDays, pickRecentDayToScrape } from "./eSeimasStore.js";

const DEFAULT_RECENT_DAYS = 180;
const DEFAULT_REFRESH_HOURS = 3;
const DEFAULT_MAX_INFLIGHT = 6;
/** Kaip retai eilė sutikrinama su progreso lentele, kai darbo joje neberandam. */
const RECONCILE_MIN_INTERVAL_MS = 60_000;

/**
 * Vienas bendras runtime visiems e-Seimas TaskRunner darbams: API srauto
 * ribotuvas ir SQLite writeris negali būti kuriami atskirai kiekvienam etapui.
 */
export function createESeimasTaskJobs({
    recentDays = DEFAULT_RECENT_DAYS,
    refreshHours = DEFAULT_REFRESH_HOURS,
    maxInflight = DEFAULT_MAX_INFLIGHT,
    createScraper = () => createRunner({
        api: createESeimasApi({ maxInflight }),
        sidecar: openESeimasSidecar(),
        concurrency: maxInflight,
    }),
    queue = {
        enqueuePending: enqueuePendingESeimasJobs,
        claimNext: claimNextESeimasJob,
        complete: completeESeimasJob,
        fail: failESeimasJob,
    },
    recentDaysStore = {
        ensure: ensureRecentScrapeDays,
        pick: pickRecentDayToScrape,
    },
} = {}) {
    let scraper = null;
    const getScraper = () => scraper ??= createScraper();

    // Sutikrinimas su progreso lentele (`enqueuePending`) perrenka VISUS dar
    // nenuskaitytus aktus, tad kainuoja šimtus ms net kai naujo darbo nėra.
    // Prieš kiekvieną darbą jo daryti nereikia: eilė nusausinama tik iš čia, tad
    // kol iš jos kas nors imasi, ji tikrai nėra tuščia. Sutikrinam tik tada, kai
    // eilė tuščia, ir ne dažniau nei kartą per RECONCILE_MIN_INTERVAL_MS.
    const lastReconcileAt = new Map();

    async function reconcileQueue(kind) {
        const now = Date.now();
        if (now - (lastReconcileAt.get(kind) ?? 0) < RECONCILE_MIN_INTERVAL_MS) return 0;
        lastReconcileAt.set(kind, now);
        return await queue.enqueuePending(kind);
    }

    async function runClaimed(kind, work) {
        let job = await queue.claimNext(kind);
        if (!job && await reconcileQueue(kind) > 0) job = await queue.claimNext(kind);
        if (!job) return false;

        try {
            await work(getScraper(), job);
            await queue.complete(job);
            return true;
        } catch (error) {
            try {
                await queue.fail(job, error);
            } catch (queueError) {
                console.error(`[e-Seimas ${kind}] nepavyko grąžinti darbo į eilę:`, queueError);
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
                runner.scrapeDocument(job.category, job.legalActId));
        },

        scrapeEditionList() {
            return runClaimed("editions", (runner, job) =>
                runner.scrapeEditionList(job.category, job.legalActId));
        },

        scrapeAsr() {
            return runClaimed("asr", (runner, job) =>
                runner.scrapeConsolidated(job.category, job.legalActId));
        },

        scrapeHistorical() {
            return runClaimed("historical", (runner, job) =>
                runner.scrapeHistoricalEdition({
                    category: job.category,
                    legalActId: job.legalActId,
                    editionToken: job.editionToken,
                }));
        },
    };
}
