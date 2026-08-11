import { processFailaiDokumentaiQueue } from "../modules/dokumentai/processFailaiDokumentaiQueue.js";
import { processETarDocumentsQueue } from "../modules/dokumentai/processETarDocumentsQueue.js";
import { processDokumentaiIndexQueue } from "../modules/dokumentai/quickwitProcessIndexQueue.js";
import { auditTeisekuraCoverage } from "../modules/teisekura/audit.js";
import { WORK_SIGNALS } from "../utils/taskSignals.js";

export default [
    {
        // eTarLegalActDocument -> dokumentai (per eTarDocumentsQueue)
        name: "processETarDocumentsQueue",
        mode: "asap",
        priority: 5,
        cooldown: 30,
        errorCooldown: 30,
        wakeOn: [WORK_SIGNALS.ETAR_DOCUMENTS_READY],
        job: processETarDocumentsQueue,
    },
    {
        // failai -> dokumentai (upsert iš failaiDokumentaiQueue)
        name: "processFailaiDokumentaiQueue",
        mode: "asap",
        priority: 5,
        cooldown: 30,
        errorCooldown: 30,
        wakeOn: [WORK_SIGNALS.FILES_DOCUMENTS_READY],
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
        wakeOn: [WORK_SIGNALS.DOCUMENTS_INDEX_READY],
        job: processDokumentaiIndexQueue,
    },
    {
        name: "auditTeisekuraCoverage",
        schedule: "37 3 * * *",
        job: auditTeisekuraCoverage,
    },
];
