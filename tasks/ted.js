import { createScraperFetch } from "../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("ted", { operation: "ted" });
import { postgres } from "../postgres/postgres.js";
import { log } from "../utils/log.js";
import { WORK_SIGNALS } from "../utils/taskSignals.js";

const TED_RPS = 1;
const TED_SCRAPE_VERSION = 2;
let lastTedRequestTime = 0;

async function throttleTedRequests() {
    const minInterval = 1000 / TED_RPS;
    const now = Date.now();
    const wait = minInterval - (now - lastTedRequestTime);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastTedRequestTime = Date.now();
}

async function fetchTedWithRetry(url, retries = 5) {
    for (let i = 0; i < retries; i += 1) {
        await throttleTedRequests();
        const response = await scrapeFetch(url);
        if (response.status === 429) {
            const wait = 10000 * (i + 1);
            log(`429, laukiame ${wait / 1000}s...`);
            await new Promise((resolve) => setTimeout(resolve, wait));
            continue;
        }
        return response;
    }
    throw new Error(`429 po ${retries} bandymų: ${url}`);
}

async function nuskaitytiTedNotice(tedNoticeNumber) {
    const url = `https://ted.europa.eu/en/notice/${tedNoticeNumber}/xml`;
    log(`TED notice: ${tedNoticeNumber}`);

    const response = await fetchTedWithRetry(url);

    if (!response.ok) {
        const scrapeStatus = response.status === 404 ? -404 : -1;
        await postgres.query(
            `INSERT INTO public."tedNotices" ("tedNoticeNumber", "scrapeStatus", "scrapeTimestamp")
             VALUES ($1, $2, NOW())
             ON CONFLICT ("tedNoticeNumber") DO UPDATE SET
                 "scrapeStatus" = EXCLUDED."scrapeStatus",
                 "scrapeTimestamp" = EXCLUDED."scrapeTimestamp"`,
            [tedNoticeNumber, scrapeStatus],
        );
        return { tedNoticeNumber, status: response.status };
    }

    const turinys = await response.text();
    await postgres.query(
        `INSERT INTO public."tedNotices" ("tedNoticeNumber", "scrapeStatus", "scrapeTimestamp", "turinys")
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT ("tedNoticeNumber") DO UPDATE SET
             "scrapeStatus" = $2,
             "scrapeTimestamp" = NOW(),
             "turinys" = EXCLUDED."turinys"`,
        [tedNoticeNumber, TED_SCRAPE_VERSION, turinys],
    );

    return { tedNoticeNumber, status: response.status };
}

async function nuskaitytiSeniausiaTedNotice() {
    const { rows } = await postgres.query(
        `SELECT "tedNoticeNumber"
         FROM public."tedNotices"
         WHERE ("scrapeStatus" IS NULL OR "scrapeStatus" >= 0)
           AND ("scrapeStatus" IS NULL OR "scrapeStatus" < $1)
         ORDER BY "scrapeStatus" ASC NULLS FIRST
         LIMIT 1`,
        [TED_SCRAPE_VERSION],
    );

    if (rows.length === 0) return false;
    await nuskaitytiTedNotice(rows[0].tedNoticeNumber);
    return true;
}

export default [
    {
        name: "nuskaitytiSeniausiaTedNotice",
        mode: "asap",
        priority: 8,
        cooldown: 60,
        errorCooldown: 10,
        wakeOn: [WORK_SIGNALS.TED_NOTICES_READY],
        job: nuskaitytiSeniausiaTedNotice,
    },
];
