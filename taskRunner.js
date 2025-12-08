import cron from "node-cron";
import { postgres } from "./postgres/postgres.js";
import { log } from "./utils/log.js";

const tasks = [];

// VTEK deklaracijos
import { nuskaitytiVtekDeklaracija } from "./tasks/vtek/nuskaityti.js";
tasks.push({
    name: "nuskaitytiVtekDeklaracijas",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 10,
    job: async () => {
        return nuskaitytiVtekDeklaracija();
    },
});

// eViesiejiPirkimai.lt sutartys
import { requestLatestEviesiejipirkimaiData } from "./tasks/sutartys/scrape.js";
tasks.push({
    name: "scrapeEviesiejipirkimaiSutartys",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 60,
    job: async () => {
        return requestLatestEviesiejipirkimaiData();
    },
});

// eViesiejiPirkimai.lt failai
import { parsiustiFaila } from "./tasks/failai/parsiusti.js";
tasks.push({
    name: "failuParsiuntimas",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 10,
    job: async () => {
        return parsiustiFaila();
    },
});

// LITEKO bylų metaduomenys (paieškos rezultatai)
import { litekoScrapeLatestDays } from "./tasks/liteko/scrape.js";
tasks.push({
    name: "scrapeLiteko",
    schedule: "0 */6 * * *",
    job: async () => {
        await litekoScrapeLatestDays(90);
    },
});

// LITEKO bylų duomenys (individualios bylos informacija)
import { surastiBylosSalis } from "./tasks/liteko/scrapeContent.js";
tasks.push({
    name: "scrapeLitekoSalys",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 10,
    job: async () => {
        return surastiBylosSalis();
    },
});

// Pravalyti OCR rezervacijas
import { pravalytiOcrRezervacijas } from "./tasks/ocr/pravalytiRezervacijas.js";
tasks.push({
    name: "pravalytiOcrRezervacijas",
    schedule: "*/5 * * * *",
    job: async () => {
        return pravalytiOcrRezervacijas();
    },
});

// JAR adresų koordinatės iš Nominatim / OpenStreetMap
import { atrastiJarAdresoKoordinates } from "./tasks/adresai/scrape.js";
tasks.push({
    name: "scrapeJarAdresoKoordinates",
    mode: "asap",
    cooldown: 60 * 60,
    errorCooldown: 10,
    job: async () => {
        return atrastiJarAdresoKoordinates();
    },
});

// eViesiejiPirkimai.lt neskelbiamos derybos
import { nuskaitytiVisasNeskelbiamasDerybas } from "./tasks/neskelbiamosDerybos/scrape.js";
tasks.push({
    name: "nuskaitytiVisasNeskelbiamasDerybas",
    schedule: "0 */3 * * *",
    job: async () => {
        await nuskaitytiVisasNeskelbiamasDerybas();
    },
});

// vpt.lrv.lt (SharePoint) melagingi tiekėjai
import { importuotiMelagingusTiekejus } from "./tasks/melagiai/scrape.js";
tasks.push({
    name: "importuotiMelagingusTiekejus",
    schedule: "0 */1 * * *",
    job: async () => {
        await importuotiMelagingusTiekejus();
    },
});

// vpt.lrv.lt (SharePoint) nepatikimi tiekėjai
import { importuotiNepatikimusTiekejus } from "./tasks/nepatikimi/scrape.js";
tasks.push({
    name: "importuotiNepatikimusTiekejus",
    schedule: "0 */1 * * *",
    job: async () => {
        await importuotiNepatikimusTiekejus();
    },
});

// Failų turinio nuskaitymas
import { nuskaitytiVienoDokumentoDuomenis } from "./tasks/failai/nuskaitytiTeksta.js";

const runningTasks = new Map();
function startAsapTask(id, jobFn, cooldownSec = 60, errorCooldownSec = 300) {
    if (runningTasks.has(id)) return; // already running

    const controller = { cancelled: false };
    controller.promise = (async function loop() {
        const cooldown = cooldownSec * 1000;
        const errorCooldown = errorCooldownSec * 1000;

        while (!controller.cancelled) {
            try {
                const result = await jobFn();

                if (result === false) {
                    // no data → wait normal cooldown
                    await new Promise((r) => setTimeout(r, cooldown));
                }
                // if result === true → skip cooldown, run immediately
            } catch (err) {
                console.error(`ASAP Task ${id} failed:`, err.message);
                // on error → wait longer cooldown
                await new Promise((r) => setTimeout(r, errorCooldown));
            }
        }
    })();

    runningTasks.set(id, controller);
    log(`Started ASAP task: ${id}`);
}

function stopAsapTask(id) {
    const controller = runningTasks.get(id);
    if (!controller) return;
    controller.cancelled = true;
    runningTasks.delete(id);
    log(`Stopped ASAP task: ${id}`);
}

// --- Periodic sync of dokumentų nuskaitytojai from Postgres ---
async function syncDokNuskaitytojai() {
    const rows = await postgres.query(`
        SELECT *
        FROM "dokNuskaitytojai"
        WHERE enabled = true
    `);

    const dbIds = new Set();

    // Start new ASAP tasks
    for (const row of rows.rows) {
        for (let i = 0; i < row.concurrency; i++) {
            const taskKey = `nuskaitytiDokumenta-${row.id}-${i}`;
            dbIds.add(taskKey);

            if (!runningTasks.has(taskKey)) {
                startAsapTask(
                    taskKey,
                    async () => nuskaitytiVienoDokumentoDuomenis(row.id),
                    10, // or row.cooldown if you store it in DB
                    10, // or row.errorCooldown if you store it in DB
                );
            }
        }
    }

    // Stop tasks that no longer exist or disabled
    for (const id of runningTasks.keys()) {
        if (!dbIds.has(id) && id.startsWith("nuskaitytiDokumenta")) {
            log(`Stopping task ${id}`);
            stopAsapTask(id);
        }
    }
}

// Initial sync
await syncDokNuskaitytojai();

// Sync every 10 seconds
setInterval(syncDokNuskaitytojai, 10_000);

for (const task of tasks) {
    if (task.mode === "asap") {
        startAsapTask(
            task.name,
            task.job,
            task.cooldown ?? 60,
            task.errorCooldown ?? 300,
        );
    } else {
        // Cron-based tasks
        let running = false;

        cron.schedule(task.schedule, async () => {
            if (running) return;

            running = true;
            try {
                await task.job();
            } catch (err) {
                console.error(`Task ${task.name} failed:`, err.message);
            } finally {
                running = false;
            }
        });
    }
}
