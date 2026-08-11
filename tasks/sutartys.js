import { isVptWorkingHours } from "../modules/sutartys/isWorkingHours.js";
import { cvpIsScrapeLeastRecentDate } from "../modules/sutartys/scrapeDay.js";
import { cvpIsScrapeOldestContract } from "../modules/sutartys/scrapeOldestContract.js";
import { cvpIsScrapeOldestDeletedContract } from "../modules/sutartys/scrapeOldestDeletedContract.js";
import { cvpIsRequestLatest } from "../modules/sutartys/scrape.js";
import { processSutartysAdpQueue } from "../modules/sutartys/processAdpQueue.js";
import { processSutartysIndexQueue } from "../modules/sutartys/quickwitProcessIndexQueue.js";
import { WORK_SIGNALS } from "../utils/taskSignals.js";

export default [
    {
        name: "scrapeEviesiejipirkimaiSutartys",
        mode: "asap",
        priority: 10,
        cooldown: 60,
        errorCooldown: 60,
        job: cvpIsRequestLatest,
    },
    {
        name: "sutartysScrapeLeastRecentDate",
        mode: "asap",
        priority: 6,
        cooldown: 30,
        errorCooldown: 30,
        job: async () => {
            if (!isVptWorkingHours()) return cvpIsScrapeLeastRecentDate();
            return false;
        },
    },
    {
        name: "sutartysScrapeOldestContract",
        mode: "asap",
        priority: 6,
        cooldown: 30,
        errorCooldown: 30,
        job: async () => {
            if (!isVptWorkingHours()) return cvpIsScrapeOldestContract();
            return false;
        },
    },
    {
        name: "sutartysScrapeOldestDeletedContract",
        mode: "asap",
        priority: 6,
        cooldown: 30,
        errorCooldown: 30,
        job: async () => {
            if (!isVptWorkingHours()) return cvpIsScrapeOldestDeletedContract();
            return false;
        },
    },
    {
        name: "processSutartysAdpQueue",
        mode: "asap",
        priority: 4,
        cooldown: 30,
        errorCooldown: 60,
        concurrency: 50,
        wakeOn: [WORK_SIGNALS.SUTARTYS_CHANGED],
        job: processSutartysAdpQueue,
    },
    {
        name: "sutartysQuickwitProcessIndexQueue",
        mode: "asap",
        priority: 5,
        concurrency: 2,
        cooldown: 30,
        errorCooldown: 30,
        wakeOn: [WORK_SIGNALS.SUTARTYS_CHANGED],
        job: processSutartysIndexQueue,
    },
];
