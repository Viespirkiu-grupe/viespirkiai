import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";

const TED_RPS = 1;
const SCRAPE_VERSION = 2;
let lastRequestTime = 0;

async function throttle() {
    const minInterval = 1000 / TED_RPS;
    const now = Date.now();
    const wait = minInterval - (now - lastRequestTime);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestTime = Date.now();
}

async function fetchWithRetry(url, retries = 5) {
    for (let i = 0; i < retries; i++) {
        await throttle();
        const response = await fetch(url);
        if (response.status === 429) {
            const wait = 10000 * (i + 1);
            log(`429, laukiame ${wait / 1000}s...`);
            await new Promise((r) => setTimeout(r, wait));
            continue;
        }
        return response;
    }
    throw new Error(`429 po ${retries} bandymų: ${url}`);
}

export async function nuskaitytiTedNotice(tedNoticeNumber) {
    const url = `https://ted.europa.eu/en/notice/${tedNoticeNumber}/xml`;

    log(`TED notice: ${tedNoticeNumber}`);

    const response = await fetchWithRetry(url);

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
        [tedNoticeNumber, SCRAPE_VERSION, turinys],
    );

    return { tedNoticeNumber, status: response.status };
}

export async function nuskaitytiSeniausiaTedNotice() {
    const { rows } = await postgres.query(
        `
          SELECT "tedNoticeNumber"
          FROM public."tedNotices"
          WHERE ("scrapeStatus" IS NULL OR "scrapeStatus" >= 0)
            AND ("scrapeStatus" IS NULL OR "scrapeStatus" < $1)
          ORDER BY "scrapeStatus" ASC NULLS FIRST
          LIMIT 1
    `,
        [SCRAPE_VERSION],
    );

    if (rows.length === 0) return false;

    await nuskaitytiTedNotice(rows[0].tedNoticeNumber);
    return true;
}

export async function scrapeTedUntilDone() {
    while (true) {
        const hasMore = await nuskaitytiSeniausiaTedNotice();
        if (!hasMore) break;
    }
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    scrapeTedUntilDone()
        .then(() => {
            log("Nuskaitymas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida:", err);
            postgres.end();
        });
}
