import { processFailaiDokumentaiQueue } from "../modules/dokumentai/processFailaiDokumentaiQueue.js";
import { processDokumentaiIndexQueue } from "../modules/dokumentai/quickwitProcessIndexQueue.js";

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
];
