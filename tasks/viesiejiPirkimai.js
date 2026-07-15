import { updateCFTS } from "../modules/viesiejiPirkimai/scrape.js";
import { processCfTDPSWS, processOldestCfTDPSWSOffHours } from "../modules/viesiejiPirkimai/scrapeCfTDPSWS.js";
import { processCfTWS, processOldestCfTWSOffHours } from "../modules/viesiejiPirkimai/scrapeCfTWS.js";
import { processPmc, processOldestPmcOffHours } from "../modules/viesiejiPirkimai/scrapePmc.js";
import { cleanReservationsHasMore } from "../modules/viesiejiPirkimai/cleanReservations.js";
import { processNextVykdytojas } from "../modules/viesiejiPirkimai/viesiejiPirkimaiVykdytojaiScrape.js";
import { processViesiejiPirkimaiIndexQueue } from "../modules/viesiejiPirkimai/quickwitProcessIndexQueue.js";

export default [
    {
        name: "updateCFTS",
        schedule: "0 */1 * * *",
        job: updateCFTS,
    },
    {
        name: "processCfTDPSWS",
        mode: "asap",
        priority: 6,
        cooldown: 60,
        errorCooldown: 60,
        job: processCfTDPSWS,
        onSuccess: (runner) => runner.nudge("failuParsiuntimas"),
    },
    {
        name: "processCfTWS",
        mode: "asap",
        priority: 6,
        cooldown: 60,
        errorCooldown: 60,
        job: processCfTWS,
        onSuccess: (runner) => runner.nudge("failuParsiuntimas"),
    },
    {
        name: "processPmc",
        mode: "asap",
        priority: 6,
        cooldown: 60,
        errorCooldown: 60,
        job: processPmc,
        onSuccess: (runner) => runner.nudge("failuParsiuntimas"),
    },
    {
        name: "processNextVykdytojas",
        mode: "asap",
        priority: 6,
        cooldown: 60,
        errorCooldown: 60,
        job: processNextVykdytojas,
    },
    {
        name: "viesiejiPirkimaiQuickwitProcessIndexQueue",
        mode: "asap",
        priority: 5,
        concurrency: 2,
        cooldown: 30,
        errorCooldown: 30,
        job: processViesiejiPirkimaiIndexQueue,
    },
    {
        // 24 concurrent backfill workers — lowest priority so they yield to everything else
        name: "processCfTDPSWSOldestOffHours",
        mode: "asap",
        priority: 1,
        concurrency: 24,
        staggerMs: 500,
        cooldown: 60,
        errorCooldown: 60,
        job: processOldestCfTDPSWSOffHours,
    },
    {
        name: "processCfTWSOldestOffHours",
        mode: "asap",
        priority: 1,
        concurrency: 24,
        staggerMs: 500,
        cooldown: 60,
        errorCooldown: 60,
        job: processOldestCfTWSOffHours,
    },
    {
        name: "processPmcOldestOffHours",
        mode: "asap",
        priority: 1,
        concurrency: 24,
        staggerMs: 500,
        cooldown: 60,
        errorCooldown: 60,
        job: processOldestPmcOffHours,
    },
    {
        name: "cleanViesiejiPirkimaiReservations",
        mode: "asap",
        priority: 4,
        cooldown: 60,
        errorCooldown: 60,
        job: cleanReservationsHasMore,
    },
];
