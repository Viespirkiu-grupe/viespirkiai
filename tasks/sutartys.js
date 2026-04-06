import { isVptWorkingHours } from "../modules/sutartys/isWorkingHours.js";
import { cvpIsScrapeLeastRecentDate } from "../modules/sutartys/scrapeDay.js";
import { cvpIsScrapeOldestContract } from "../modules/sutartys/scrapeOldestContract.js";
import { cvpIsRequestLatest } from "../modules/sutartys/scrape.js";

export default [
    {
        name: "scrapeEviesiejipirkimaiSutartys",
        mode: "asap",
        priority: 10,
        cooldown: 60,
        errorCooldown: 60,
        job: cvpIsRequestLatest,
        // nudges failuParsiuntimas on success — wired up in index.js
        onSuccess: (runner) => runner.nudge("failuParsiuntimas"),
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
];
