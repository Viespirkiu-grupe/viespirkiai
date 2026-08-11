import { processFailaiDokumentaiQueue } from "../modules/dokumentai/processFailaiDokumentaiQueue.js";
import { processETarDocumentsQueue } from "../modules/dokumentai/processETarDocumentsQueue.js";
import { processDokumentaiIndexQueue } from "../modules/dokumentai/quickwitProcessIndexQueue.js";
import { scrapeLatest as scrapeEseimasLatest } from "../modules/eseimas/scrape.js";
import { scrapeNextProjectBatch } from "../modules/eseimas/scrapeContent.js";
import { auditTeisekuraCoverage } from "../modules/teisekura/audit.js";

export default [
    {
        // eTarLegalActDocument -> dokumentai (per eTarDocumentsQueue)
        name: "processETarDocumentsQueue",
        mode: "asap",
        priority: 5,
        cooldown: 30,
        errorCooldown: 30,
        job: processETarDocumentsQueue,
    },
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
        concurrency: 4,
        cooldown: 30,
        errorCooldown: 30,
        job: processDokumentaiIndexQueue,
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
