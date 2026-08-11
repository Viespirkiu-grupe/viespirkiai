import { updateCFTS } from "../modules/viesiejiPirkimai/scrape.js";
import { processCfTDPSWS, processOldestCfTDPSWSOffHours } from "../modules/viesiejiPirkimai/scrapeCfTDPSWS.js";
import { processCfTWS, processOldestCfTWSOffHours } from "../modules/viesiejiPirkimai/scrapeCfTWS.js";
import { processPmc, processOldestPmcOffHours } from "../modules/viesiejiPirkimai/scrapePmc.js";
import { cleanReservationsHasMore } from "../modules/viesiejiPirkimai/cleanReservations.js";
import { processNextVykdytojas } from "../modules/viesiejiPirkimai/viesiejiPirkimaiVykdytojaiScrape.js";
import { processViesiejiPirkimaiIndexQueue } from "../modules/viesiejiPirkimai/quickwitProcessIndexQueue.js";
import { updateRecentPlanuojamiPirkimai } from "../modules/viesiejiPirkimai/updatePlanuojamiPirkimai.js";
import { processNextPlanuojamuPirkimuVykdytojas } from "../modules/viesiejiPirkimai/planuojamiPirkimaiVykdytojai.js";
import { WORK_SIGNALS } from "../utils/taskSignals.js";

export default [
    {
        name: "updateCFTS",
        schedule: "0 */1 * * *",
        job: updateCFTS,
    },
    {
        name: "updateRecentPlanuojamiPirkimai",
        // Tikrinama kas valandą; pats job'as VPT darbo metu iškart praleidžia darbą.
        schedule: "23 * * * *",
        job: updateRecentPlanuojamiPirkimai,
    },
    {
        name: "processNextPlanuojamuPirkimuVykdytojas",
        mode: "asap",
        priority: 1,
        concurrency: 1,
        cooldown: 30,
        errorCooldown: 60,
        job: processNextPlanuojamuPirkimuVykdytojas,
    },
    {
        name: "processCfTDPSWS",
        mode: "asap",
        priority: 6,
        cooldown: 60,
        errorCooldown: 60,
        job: processCfTDPSWS,
    },
    {
        name: "processCfTWS",
        mode: "asap",
        priority: 6,
        cooldown: 60,
        errorCooldown: 60,
        job: processCfTWS,
    },
    {
        name: "processPmc",
        mode: "asap",
        priority: 6,
        cooldown: 60,
        errorCooldown: 60,
        job: processPmc,
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
        wakeOn: [WORK_SIGNALS.VIESIEJI_PIRKIMAI_CHANGED],
        job: processViesiejiPirkimaiIndexQueue,
    },
    {
        // 24 concurrent backfill workers — lowest priority so they yield to everything else
        name: "processCfTDPSWSOldestOffHours",
        mode: "asap",
        priority: 1,
        concurrency: 1,
        staggerMs: 500,
        cooldown: 5,
        errorCooldown: 300,
        job: processOldestCfTDPSWSOffHours,
    },
    {
        name: "processCfTWSOldestOffHours",
        mode: "asap",
        priority: 1,
        concurrency: 1,
        staggerMs: 500,
        cooldown: 5,
        errorCooldown: 300,
        job: processOldestCfTWSOffHours,
    },
    {
        name: "processPmcOldestOffHours",
        mode: "asap",
        priority: 1,
        concurrency: 1,
        staggerMs: 500,
        cooldown: 5,
        errorCooldown: 300,
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
