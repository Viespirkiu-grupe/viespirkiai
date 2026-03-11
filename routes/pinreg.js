import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";
import { highlightCode } from "../utils/highlightCode.js";
import { spawn } from "child_process";
import { log } from "../utils/log.js";
import { postgres } from "../postgres/postgres.js";

const UUID_REGEX =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPSERT_BATCH_SIZE = 1000;
const SCRAPE_RENDER_DEFAULTS = { customHead: config.customHead, highlightCode };

/**
 * @param {string} uuid
 * @returns {Promise<void>}
 */
function fetchUUID(uuid) {
    return new Promise((resolve, reject) => {
        const url = `https://pinreg.vtek.lt/external/deklaracijos/${uuid}/view/viesa`;
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
        curl.on("error", reject);
        curl.on("close", () => {
            const status = output.slice(-3);
            if (status !== "200") return reject(new Error(`Status ${status}`));
            try {
                JSON.parse(output.slice(0, -3));
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    });
}

/**
 * @param {string[]} uuids
 * @returns {Promise<boolean>}
 */
export async function patikrintiUUID(uuids) {
    if (!Array.isArray(uuids) || uuids.length === 0) return false;

    const sample = [...uuids].sort(() => Math.random() - 0.5).slice(0, 5);
    let failCount = 0;

    for (const uuid of sample) {
        try {
            await fetchUUID(uuid);
        } catch (err) {
            log(`UUID ${uuid} nepavyko nuskaityti: ${err.message}`);
            failCount++;
        }
    }

    if (sample.length < 5) return failCount === 0;
    return failCount < 2;
}

/**
 * @param {string[]} uuids
 * @returns {Promise<void>}
 */
export async function upsertUUIDs(uuids) {
    if (!Array.isArray(uuids) || uuids.length === 0) return;

    for (let i = 0; i < uuids.length; i += UPSERT_BATCH_SIZE) {
        const batch = uuids.slice(i, i + UPSERT_BATCH_SIZE);
        const placeholders = batch.map((_, idx) => `($${idx + 1})`).join(", ");
        await postgres.query(
            `INSERT INTO pinreg (uuid) VALUES ${placeholders} ON CONFLICT (uuid) DO NOTHING`,
            batch,
        );
    }
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function parseUUIDs(raw) {
    return raw
        .split("\n")
        .map((u) => u.trim())
        .filter((u) => UUID_REGEX.test(u));
}

const pinregRouter = express.Router();

pinregRouter.get("/pinreg/scrape", (req, res) => {
    res.render("pinreg/scrape", SCRAPE_RENDER_DEFAULTS);
});

pinregRouter.post("/pinreg/scrape", async (req, res) => {
    const { uuids: raw } = req.body;
    if (!raw) return res.status(400).send("UUIDs are required");

    const uuids = parseUUIDs(raw);
    if (!uuids.length)
        return res.render("pinreg/scrape", {
            ...SCRAPE_RENDER_DEFAULTS,
            uuidSubmitMessage: "Galiojančių UUID nepateikta.",
        });

    if (!(await patikrintiUUID(uuids)))
        return res.render("pinreg/scrape", {
            ...SCRAPE_RENDER_DEFAULTS,
            uuidSubmitMessage: "Duoti UUID negalioja.",
        });

    await upsertUUIDs(uuids);

    res.render("pinreg/scrape", {
        ...SCRAPE_RENDER_DEFAULTS,
        uuidSubmitMessage: `Gauti ${uuids.length} UUID, ačiū!`,
    });
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
