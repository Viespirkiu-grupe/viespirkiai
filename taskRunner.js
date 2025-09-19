import cron from "node-cron";
import fs from "fs/promises";

// Create a folder taskState if it doens't exist
try {
    await fs.mkdir("./taskState");
} catch (err) {
    if (err.code !== "EEXIST") {
        console.error("Error creating taskState directory:", err);
    }
}

const tasks = [];

import { requestLatestEviesiejipirkimaiData } from "./tasks/sutartys/scrape.js";
tasks.push({
    name: "scrapeEviesiejipirkimaiSutartys",
    mode: "asap",
    cooldown: 60,
    job: async () => {
        return requestLatestEviesiejipirkimaiData();
    },
});

import { parsiustiFaila } from "./tasks/failai/parsiusti.js";
tasks.push({
    name: "failuParsiuntimas",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 5,
    job: async () => {
        return parsiustiFaila();
    },
});

tasks.push({
    name: "failuParsiuntimas2",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 5,
    job: async () => {
        return parsiustiFaila();
    },
});

import { litekoScrapeLatestDays } from "./tasks/liteko/scrape.js";
tasks.push({
    name: "scrapeLiteko",
    schedule: "0 */6 * * *",
    job: async () => {
        await litekoScrapeLatestDays(90);
    },
});

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

import { nuskaitytiVienoDokumentoDuomenis } from "./tasks/failai/nuskaitytiTeksta.js";
tasks.push({
    name: "nuskaitytiDokumentoTekstaViespirkis",
    mode: "asap",
    cooldown: 10,
    errorCooldown: 2,
    job: async () => {
        return nuskaitytiVienoDokumentoDuomenis(1);
    },
});

tasks.push({
    name: "nuskaitytiDokumentoTekstaViespirkisRDP",
    mode: "asap",
    cooldown: 10,
    errorCooldown: 2,
    job: async () => {
        return nuskaitytiVienoDokumentoDuomenis(2);
    },
});

tasks.push({
    name: "nuskaitytiDokumentoTekstaViespirkisRFC",
    mode: "asap",
    cooldown: 10,
    errorCooldown: 2,
    job: async () => {
        return nuskaitytiVienoDokumentoDuomenis(3);
    },
});

tasks.push({
    name: "nuskaitytiDokumentoTekstaMeskaAntDviracio",
    mode: "asap",
    cooldown: 10,
    errorCooldown: 2,
    job: async () => {
        return nuskaitytiVienoDokumentoDuomenis(4);
    },
});

import { atnaujintiStatistika } from "./tasks/statistika/atnaujinti.js";
tasks.push({
    name: "atnaujintiStatistika",
    schedule: "*/10 * * * *",
    job: async () => {
        await atnaujintiStatistika();
    },
});

for (const task of tasks) {
    if (task.mode === "asap") {
        const cooldown = (task.cooldown ?? 60) * 1000; // default false/no-data cooldown
        const errorCooldown = (task.errorCooldown ?? 300) * 1000; // default error cooldown

        (async function loop() {
            while (true) {
                try {
                    const result = await task.job();
                    if (result === false) {
                        // no data, wait normal cooldown
                        await new Promise((r) => setTimeout(r, cooldown));
                    }
                } catch (err) {
                    console.error(`Task ${task.name} failed:`, err.message);
                    // error, wait longer cooldown
                    await new Promise((r) => setTimeout(r, errorCooldown));
                }
            }
        })();
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
