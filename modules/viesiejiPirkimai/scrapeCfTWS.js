import { postgres } from "../../postgres/postgres.js";
import pLimit from "p-limit";
import Timings from "../../utils/timings.js";
import { log } from "../../utils/log.js";
import { isVptWorkingHours } from "../sutartys/isWorkingHours.js";
import {
    parseCfTWS,
    parseFailai,
    parseSkelbimai,
    parseVersijos,
} from "./parsers.js";

const WINDOW_MS = 5000; // fixed smoothing window
const HOST = "https://viesiejipirkimai.lt";
const timestamps = [];

/**
 * Records a request timestamp for RPS calculation.
 * @returns {void}
 */
export function markRequest() {
    const now = Date.now();
    timestamps.push(now);
    cleanup(now);
}

/**
 * Returns a formatted requests-per-second value using a rolling window.
 * @returns {string}
 */
export function getRpsFormatted() {
    const now = Date.now();
    cleanup(now);

    const rate = (timestamps.length * 1000) / WINDOW_MS;

    return rate < 10
        ? rate.toFixed(2)
        : rate < 100
          ? rate.toFixed(1)
          : String(Math.round(rate));
}

/**
 * Cleans up old timestamps outside the rolling window.
 * @param {number} now
 * @returns {void}
 */
function cleanup(now) {
    const cutoff = now - WINDOW_MS;
    while (timestamps.length && timestamps[0] < cutoff) {
        timestamps.shift();
    }
}

function formatLastScrapeTime(value) {
    if (!value) return "nenustatyta";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

const QUEUE_SIZE = 1000;
const cftQueue = [];
let refillPromise = null;

/**
 * Refills the in-memory queue with items to process.
 * @returns {Promise<void>}
 */
async function refillQueue() {
    if (cftQueue.length > 0) return;

    if (refillPromise) {
        await refillPromise;
        return;
    }

    refillPromise = (async () => {
        const { rows } = await postgres.query(
            `
            SELECT *
            FROM public."viesiejiPirkimai"
            WHERE type = 'CfTWS'
              AND ("turinioNuskaitymas" IS NULL OR "turinioNuskaitymas" = 0)
            FOR UPDATE SKIP LOCKED
            LIMIT $1
            `,
            [QUEUE_SIZE],
        );

        cftQueue.push(...rows);
    })();

    try {
        await refillPromise;
    } finally {
        refillPromise = null;
    }
}

/**
 * Gets the next item from the queue.
 * @returns {Promise<object | null>}
 */
export async function getNextCft() {
    if (cftQueue.length === 0) {
        await refillQueue();
    }
    return cftQueue.shift() ?? null;
}

/**
 * Fetches a URL and returns response text while tracking RPS.
 * @param {string} url
 * @returns {Promise<string>}
 */
async function fetchText(url) {
    const response = await fetch(url, { redirect: "follow" });
    markRequest();

    const redirectedUrl = response.url || "";
    const wasRedirectedToCas =
        redirectedUrl.startsWith("https://viesiejipirkimai.lt/cas/login?") ||
        response.headers
            .get("location")
            ?.startsWith("https://viesiejipirkimai.lt/cas/login?");

    if (wasRedirectedToCas) {
        const error = new Error("CAS redirect");
        error.casRedirect = true;
        error.casLocation = redirectedUrl;
        throw error;
    }

    return response.text();
}

/**
 * Processes a single CfTWS record.
 * Returns false if no work is left, true otherwise.
 * @param {object} [options]
 * @param {number} [options.versionConcurrency=8]
 * @returns {Promise<boolean>}
 */
async function processCfTWSRecord(cft, options = {}) {
    const versionConcurrency = options.versionConcurrency ?? 8;

    const timings = new Timings();
    try {
        const url = `${HOST}/epps/cft/prepareViewCfTWS.do?resourceId=${cft.pirkimoId}`;
        timings.start("fetchMain");
        const text = await fetchText(url);
        timings.end("fetchMain");

        const result = await parseCfTWS(text);

        const skelbimaiUrl = `${HOST}/epps/cft/viewContractNotices.do?resourceId=${cft.pirkimoId}&T01_ps=10000`;
        timings.start("fetchNotices");
        const textSkelbimai = await fetchText(skelbimaiUrl);
        timings.end("fetchNotices");
        result.skelbimai = await parseSkelbimai(textSkelbimai);

        const failaiUrl = `${HOST}/epps/cft/listContractDocuments.do?d-5419-p=&resourceId=${cft.pirkimoId}&T02_ps=10000`;
        timings.start("fetchFiles");
        const textFailai = await fetchText(failaiUrl);
        timings.end("fetchFiles");

        const failai = await parseFailai(textFailai);

        const limit = pLimit(versionConcurrency);

        timings.start("fetchVersions");
        await Promise.all(
            failai.map((file) =>
                limit(async () => {
                    if (!file.versijosExists) return;

                    const versijosUrl = `${HOST}/epps/cft/viewDocumentVersions.do?resourceId=${file.dokumentasId}&d-16398-p=&T02_ps=10000`;
                    const textVersijos = await fetchText(versijosUrl);
                    file.versijos = await parseVersijos(textVersijos);
                }),
            ),
        );
        timings.end("fetchVersions");

        result.failai = failai;

        const failaiFlat = failai.flatMap((failas) => {
            if (!failas.versijosExists || !failas.versijos) return [];

            return failas.versijos.map((v) => ({
                saltinis: "cvpIs",
                saltinioId: `${cft.pirkimoId}/${failas.dokumentasId}/${v.versionId}`,
                pavadinimas: failas.dokumentasPavadinimas,
                extension: failas.dokumentasPavadinimas?.split(".").pop() || "",
            }));
        });

        timings.start("upsertFiles");
        if (failaiFlat.length > 0) {
            const failaiValues = [];
            const failaiPlaceholders = failaiFlat
                .map((f, i) => {
                    const start = i * 4 + 1;
                    failaiValues.push(f.saltinis);
                    failaiValues.push(f.saltinioId);
                    failaiValues.push(f.pavadinimas);
                    failaiValues.push(f.extension);
                    return `($${start}, $${start + 1}, $${start + 2}, $${start + 3})`;
                })
                .join(", ");

            const failaiQuery = `
            INSERT INTO public."failai"
            ("saltinis", "saltinioId", "pavadinimas", "extension")
            VALUES ${failaiPlaceholders}
            ON CONFLICT ("saltinis", "saltinioId") WHERE (saltinis IS NOT NULL AND saltinis <> 'archive' AND "saltinioId" IS NOT NULL) DO NOTHING;
            `;

            await postgres.query(failaiQuery, failaiValues);
        }
        timings.end("upsertFiles");

        timings.start("updatePurchase");
        await postgres.query(
            `
      UPDATE public."viesiejiPirkimai"
      SET "turinioNuskaitymas" = 1,
          "turinioNuskaitymoData" = NOW(),
          "scrapeReservation" = NULL,
          turinys = $1
      WHERE "pirkimoId" = $2
      `,
            [result, cft.pirkimoId],
        );
        timings.end("updatePurchase");

        timings.end("all");
        log(
            `Nuskaitytas CfTWS id ${cft.pirkimoId} | fetch ${timings.humanDuration("fetchMain")}/${timings.humanDuration("fetchNotices")}/${timings.humanDuration("fetchFiles")}/${timings.humanDuration("fetchVersions")} | upsert ${timings.humanDuration("upsertFiles")}/${timings.humanDuration("updatePurchase")} | viso ${timings.humanDuration()}`,
        );
    } catch (error) {
        console.error(`Klaida apdorojant pirkimą ID ${cft.pirkimoId}:`, error);

        const status = error?.casRedirect ? -404 : -1;

        await postgres.query(
            `
      UPDATE public."viesiejiPirkimai"
      SET "turinioNuskaitymas" = $1,
          "turinioNuskaitymoData" = NOW(),
          "scrapeReservation" = NULL
      WHERE "pirkimoId" = $2
      `,
            [status, cft.pirkimoId],
        );
    }

    return true;
}

export async function processCfTWS(options = {}) {
    const cft = await getNextCft();
    if (!cft) return false;

    await processCfTWSRecord(cft, options);
    return true;
}

/**
 * Processes the oldest CfTWS record by turinioNuskaitymoData during off-hours.
 * Returns false if working hours or if the oldest is over 12 hours old.
 * @param {object} [options]
 * @param {number} [options.versionConcurrency=8]
 * @returns {Promise<boolean>}
 */
export async function processOldestCfTWSOffHours(options = {}) {
    if (isVptWorkingHours()) return false;

    const { rows } = await postgres.query(
        `
            WITH candidate AS (
                SELECT "pirkimoId"
                FROM public."viesiejiPirkimai"
                WHERE type = 'CfTWS'
                  AND ("turinioNuskaitymas" = 1 OR "turinioNuskaitymas" = -1)
                  AND "turinioNuskaitymoData" IS NOT NULL
                  AND "turinioNuskaitymoData" <=
                      (now() AT TIME ZONE 'Europe/Vilnius') - INTERVAL '12 hours'
                ORDER BY "turinioNuskaitymoData" ASC
                FOR UPDATE SKIP LOCKED
                LIMIT 1
            )
            UPDATE public."viesiejiPirkimai" v
            SET "turinioNuskaitymas" = -2,
                "scrapeReservation" = (now() AT TIME ZONE 'Europe/Vilnius')
            FROM candidate
            WHERE v."pirkimoId" = candidate."pirkimoId"
            RETURNING v.*;
            `,
    );

    const cft = rows[0];
    if (!cft) return false;

    await processCfTWSRecord(cft, options);
    return true;
}

const WORKERS = 32;

if (import.meta.url === `file://${process.argv[1]}`) {
    const maxArg = Number(process.argv[2]);
    const maxCount =
        Number.isFinite(maxArg) && maxArg > 0 ? Math.floor(maxArg) : null;

    try {
        if (maxCount) {
            for (let i = 0; i < maxCount; i += 1) {
                const didWork = await processCfTWS();
                if (!didWork) break;
            }
        } else {
            await Promise.all(
                Array.from({ length: WORKERS }, async () => {
                    while (await processCfTWS()) {}
                }),
            );
        }
    } finally {
        await postgres.end();
    }
}
