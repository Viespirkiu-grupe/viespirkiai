import config from "../utils/config.js";
import { createESeimasTaskJobs } from "../modules/eSeimas/eSeimasTaskJobs.js";
import { WORK_SIGNALS } from "../utils/taskSignals.js";

// Be adapterio adreso užduočių net neregistruojam: taip frontend'o ar dalinėje
// backend aplinkoje neatsiras penki nuolat klaidas rašantys workeriai.
if (!config.eTarApiUrl) {
    console.warn("[e-Seimas] ETAR_API_URL nenustatytas — TaskRunner darbai išjungti");
}

const jobs = createESeimasTaskJobs({
    recentDays: config.eSeimasRecentDays,
    refreshHours: config.eSeimasRefreshHours,
    maxInflight: config.eSeimasMaxInflight,
});

export default config.eTarApiUrl ? [
    {
        name: "eSeimasDiscoverRecentDays",
        mode: "asap",
        concurrency: 1,
        priority: 5,
        cooldown: 300,
        errorCooldown: 300,
        job: jobs.scrapeRecentDay,
    },
    {
        name: "eSeimasScrapeDocuments",
        mode: "asap",
        concurrency: 2,
        priority: 5,
        cooldown: 30,
        errorCooldown: 60,
        wakeOn: [WORK_SIGNALS.ESEIMAS_SCRAPE_READY],
        job: jobs.scrapeDocument,
    },
    {
        name: "eSeimasScrapeEditionLists",
        mode: "asap",
        concurrency: 1,
        priority: 4,
        cooldown: 30,
        errorCooldown: 60,
        wakeOn: [WORK_SIGNALS.ESEIMAS_SCRAPE_READY],
        job: jobs.scrapeEditionList,
    },
    {
        name: "eSeimasScrapeAsr",
        mode: "asap",
        concurrency: 1,
        priority: 4,
        cooldown: 30,
        errorCooldown: 60,
        wakeOn: [WORK_SIGNALS.ESEIMAS_SCRAPE_READY],
        job: jobs.scrapeAsr,
    },
    {
        name: "eSeimasScrapeHistorical",
        mode: "asap",
        concurrency: 2,
        priority: 3,
        cooldown: 30,
        errorCooldown: 60,
        wakeOn: [WORK_SIGNALS.ESEIMAS_SCRAPE_READY],
        job: jobs.scrapeHistorical,
    },
] : [];
