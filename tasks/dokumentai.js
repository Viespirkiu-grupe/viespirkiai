import { processFailaiDokumentaiQueue } from "../modules/dokumentai/processFailaiDokumentaiQueue.js";
import { processDokumentaiIndexQueue } from "../modules/dokumentai/quickwitProcessIndexQueue.js";
import { scrapeLatest as scrapeEtarLatest } from "../modules/etar/scrape.js";
import { scrapeNextBatch as scrapeEtarContent } from "../modules/etar/scrapeContent.js";
import { scrapeLatest as scrapeEseimasLatest } from "../modules/eseimas/scrape.js";
import { scrapeNextProjectBatch } from "../modules/eseimas/scrapeContent.js";
import { auditTeisekuraCoverage } from "../modules/teisekura/audit.js";

export default [
    {
        // failai -> dokumentai (upsert iš failaiDokumentaiQueue)
        name: "processFailaiDokumentaiQueue",
        mode: "asap",
        priority: 5,
        cooldown: 30,
        errorCooldown: 30,
        job: processFailaiDokumentaiQueue,
    },
    {
        // dokumentai -> quickwit (indeksavimas iš dokumentaiIndexQueue)
        name: "dokumentaiQuickwitProcessIndexQueue",
        mode: "asap",
        priority: 5,
        cooldown: 30,
        errorCooldown: 30,
        job: processDokumentaiIndexQueue,
    },
    {
        name: "scrapeEtarLatest",
        schedule: "7 * * * *",
        job: () => scrapeEtarLatest(100),
    },
    {
        name: "scrapeEtarContent",
        mode: "asap",
        priority: 4,
        cooldown: 30,
        errorCooldown: 60,
        job: scrapeEtarContent,
    },
    {
        name: "scrapeEseimasLatest",
        schedule: "17 * * * *",
        job: scrapeEseimasLatest,
    },
    {
        name: "scrapeEseimasProjects",
        mode: "asap",
        priority: 4,
        cooldown: 30,
        errorCooldown: 60,
        job: scrapeNextProjectBatch,
    },
    {
        name: "auditTeisekuraCoverage",
        schedule: "37 3 * * *",
        job: auditTeisekuraCoverage,
    },
];
