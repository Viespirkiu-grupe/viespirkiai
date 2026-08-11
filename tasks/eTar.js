import config from "../utils/config.js";
import { createETarTaskJobs } from "../modules/eTar/eTarTaskJobs.js";

// Be adapterio adreso užduočių net neregistruojam: taip frontend'o ar dalinėje
// backend aplinkoje neatsiras penki nuolat klaidas rašantys workeriai.
if (!config.eTarApiUrl) {
    console.warn("[e-TAR] ETAR_API_URL nenustatytas — TaskRunner darbai išjungti");
}

const jobs = createETarTaskJobs({
    recentDays: config.eTarRecentDays,
    refreshHours: config.eTarRefreshHours,
    maxInflight: config.eTarMaxInflight,
});

export default config.eTarApiUrl ? [
    {
        name: "eTarDiscoverRecentDays",
        mode: "asap",
        concurrency: 1,
        priority: 5,
        cooldown: 300,
        errorCooldown: 300,
        job: jobs.scrapeRecentDay,
    },
    {
        name: "eTarScrapeDocuments",
        mode: "asap",
        concurrency: 2,
        priority: 5,
        cooldown: 30,
        errorCooldown: 60,
        job: jobs.scrapeDocument,
    },
    {
        name: "eTarScrapeEditionLists",
        mode: "asap",
        concurrency: 1,
        priority: 4,
        cooldown: 30,
        errorCooldown: 60,
        job: jobs.scrapeEditionList,
    },
    {
        name: "eTarScrapeAsr",
        mode: "asap",
        concurrency: 1,
        priority: 4,
        cooldown: 30,
        errorCooldown: 60,
        job: jobs.scrapeAsr,
    },
    {
        name: "eTarScrapeHistorical",
        mode: "asap",
        concurrency: 2,
        priority: 3,
        cooldown: 30,
        errorCooldown: 60,
        job: jobs.scrapeHistorical,
    },
] : [];
