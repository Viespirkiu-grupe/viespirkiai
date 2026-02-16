import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { highlightCode } from "../utils/highlightCode.js";
import { spawn } from "child_process";
import { log } from "../utils/log.js";
import { postgres } from "../postgres/postgres.js";

/**
 * Upsert an array of UUIDs into pinreg table
 * @param {string[]} uuids - Array of UUID strings
 */
export async function upsertUUIDs(uuids) {
    if (!Array.isArray(uuids) || uuids.length === 0) return;

    // Split into batches to avoid too many parameters
    const BATCH_SIZE = 1000;
    for (let i = 0; i < uuids.length; i += BATCH_SIZE) {
        const batch = uuids.slice(i, i + BATCH_SIZE);
        const placeholders = batch.map((_, idx) => `($${idx + 1})`).join(", ");
        const query = `
            INSERT INTO pinreg (uuid)
            VALUES ${placeholders}
            ON CONFLICT (uuid) DO NOTHING;
        `;
        await postgres.query(query, batch);
    }
}

/**
 * Patikrina atsitiktinius 5 UUID. Jei bent 2 nepavyksta nuskaityti, grąžina false.
 * @param {string[]} uuids
 * @returns {Promise<boolean>} true – jei mažiau nei 2 nepavyko, false – jei 2 ar daugiau nepavyko
 */
export async function patikrintiUUID(uuids) {
    if (!Array.isArray(uuids) || uuids.length === 0) return false;

    // Atsitiktinai parenkame iki 5 UUID
    const shuffled = uuids.sort(() => Math.random() - 0.5);
    const toCheck = shuffled.slice(0, Math.min(5, uuids.length));

    let failCount = 0;

    for (const uuid of toCheck) {
        try {
            const url = `https://pinreg.vtek.lt/external/deklaracijos/${uuid}/view/viesa`;
            await new Promise((resolve, reject) => {
                const curl = spawn("curl", [
                    "-s",
                    "-w",
                    "%{http_code}",
                    "-o",
                    "-",
                    url,
                ]);

                let output = "";
                curl.stdout.on("data", (chunk) => {
                    output += chunk;
                });

                curl.on("close", () => {
                    const status = output.slice(-3);
                    const body = output.slice(0, -3);

                    if (status !== "200")
                        return reject(new Error(`Status ${status}`));

                    try {
                        JSON.parse(body);
                        resolve();
                    } catch (err) {
                        reject(err);
                    }
                });

                curl.on("error", (err) => reject(err));
            });
        } catch (err) {
            log(`UUID ${uuid} nepavyko nuskaityti: ${err.message}`);
            failCount++;
        }
    }

    // Jei mažiau nei 5 UUID, bet bent 1 nepavyko – reject
    if (toCheck.length < 5 && failCount > 0) return false;

    // Jei 5 UUID, reject tik jei 2 ar daugiau nepavyko
    if (toCheck.length === 5 && failCount >= 2) return false;

    return true;
}

const pinregRouter = express.Router();

pinregRouter.get("/pinreg/scrape", async (req, res) => {
    res.render("pinreg/scrape", {
        customHead: config.customHead,
        highlightCode,
    });
});

pinregRouter.post("/pinreg/scrape", async (req, res) => {
    try {
        const { uuids } = req.body; // get textarea input
        if (!uuids) {
            return res.status(400).send("UUIDs are required");
        }

        // Split by newlines and trim each UUID
        let uuidList = uuids
            .split("\n")
            .map((u) => u.trim())
            .filter(Boolean);

        // Filter invalid uuids
        const validUuidList = uuidList.filter((u) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                u,
            ),
        );
        if (validUuidList.length === 0) {
            return res.render("pinreg/scrape", {
                customHead: config.customHead,
                highlightCode,
                uuidSubmitMessage: `Galiojančių UUID nepateikta.`,
            });
        }

        uuidList = validUuidList;

        const result = await patikrintiUUID(uuidList);
        if (!result) {
            return res.render("pinreg/scrape", {
                customHead: config.customHead,
                highlightCode,
                uuidSubmitMessage: `Duoti UUID negalioja.`,
            });
        }

        await upsertUUIDs(uuidList);

        // Render the same page with a success message or redirect
        res.render("pinreg/scrape", {
            customHead: config.customHead,
            highlightCode,
            uuidSubmitMessage: `Gauti ${uuidList.length} UUID, ačiū!`,
        });
    } catch (err) {
        console.error(err);
        res.status(500).send("Server error");
    }
});

pinregRouter.get("/pinreg/scrape.png", async (req, res) => {
    return await serveOpenGraphImage(
        res,
        "Viešpirkiai pilietinė iniciatyva",
        "Privačių interesų registro duomenų atnaujinimo puslapis",
        "",
        "viespirkiai.org/pinreg/scrape",
    );
});

export default pinregRouter;
