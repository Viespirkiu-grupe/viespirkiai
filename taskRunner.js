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

import { requestLatestEviesiejipirkimaiData } from "./scrape/scrapeViespirkiai.js";
tasks.push({
    name: "scrapeEviesiejipirkimaiSutartys",
    schedule: "*/1 * * * *",
    job: async () => {
        await requestLatestEviesiejipirkimaiData();
    },
});

import { importuotiDokumentus } from "./import/importFailai.js";
tasks.push({
    name: "dokumentuImportas",
    schedule: "*/1 * * * *",
    job: async () => {
        await importuotiDokumentus();
    },
});

import { parsiustiFaila } from "./scrape/parsiustiFailus.js";
tasks.push({
    name: "failuParsiuntimas",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 5,
    job: async () => {
        return parsiustiFaila();
    },
});

import { litekoScrapeLatestDays } from "./scrape/scrapeLiteko.js";
tasks.push({
    name: "scrapeLiteko",
    schedule: "0 */6 * * *",
    cooldown: 60,
    errorCooldown: 10,
    job: async () => {
        await litekoScrapeLatestDays(90);
    },
});

import { surastiBylosSalis } from "./scrape/scrapeLitekoContent.js";
tasks.push({
    name: "scrapeLitekoSalys",
    mode: "asap",
    cooldown: 60,
    errorCooldown: 10,
    job: async () => {
        return surastiBylosSalis();
    },
});

import { atrastiJarAdresoKoordinates } from "./scrape/scrapeAdresai.js";
tasks.push({
    name: "scrapeJarAdresoKoordinates",
    mode: "asap",
    cooldown: 60 * 60,
    errorCooldown: 10,
    job: async () => {
        return atrastiJarAdresoKoordinates();
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
