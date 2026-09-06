import { processFilesDocumentsQueue } from "../modules/documents/processFilesQueue.js";
import { processETarDocumentsQueue } from "../modules/documents/processETarQueue.js";
import { processDocumentsIndexQueue } from "../modules/documents/quickwitProcessIndexQueue.js";
import { auditTeisekuraCoverage } from "../modules/teisekura/audit.js";
import { WORK_SIGNALS } from "../utils/taskSignals.js";

// Užduočių `name` reikšmės sąmoningai nepervadintos: jomis remiasi TaskRunner
// būsena ir dba.lenteles."uzduotys". Pasikeitė tik importuojami moduliai.
export default [
    {
        // eTarLegalActDocument -> documents (per eTarDocumentsQueue)
        name: "processETarDocumentsQueue",
        mode: "asap",
        priority: 5,
        cooldown: 30,
        errorCooldown: 30,
        wakeOn: [WORK_SIGNALS.ETAR_DOCUMENTS_READY],
        job: processETarDocumentsQueue,
    },
    {
        // files -> documents (upsert iš files."documentsQueue")
        name: "processFailaiDokumentaiQueue",
        mode: "asap",
        priority: 5,
        cooldown: 30,
        errorCooldown: 30,
        wakeOn: [WORK_SIGNALS.FILES_DOCUMENTS_READY],
        job: processFilesDocumentsQueue,
    },
    {
        // documents -> quickwit (indeksavimas iš documents."indexQueue")
        name: "dokumentaiQuickwitProcessIndexQueue",
        mode: "asap",
        priority: 5,
        concurrency: 4,
        cooldown: 30,
        errorCooldown: 30,
        wakeOn: [WORK_SIGNALS.DOCUMENTS_INDEX_READY],
        job: processDocumentsIndexQueue,
    },
    {
        name: "auditTeisekuraCoverage",
        schedule: "37 3 * * *",
        job: auditTeisekuraCoverage,
    },
];
