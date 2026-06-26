import { parseHTML } from "linkedom";
import PQueue from "p-queue";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import Timings from "../../utils/timings.js";
import config from "../../utils/config.js";

const PAGE_SIZE = 1000;

/**
 * Converts a date string in "DD/MM/YYYY HH:mm" format to a PostgreSQL timestamp string.
 * @param {string | null | undefined} dateStr
 * @returns {string | null}
 */
function formatPgDate(dateStr) {
    if (!dateStr) return null;

    const parts = dateStr.trim().split(" ");
    if (parts.length !== 2) return null; // invalid format

    const [datePart, timePart] = parts;
    const [d, m, y] = datePart.split("/");
    if (!d || !m || !y) return null; // invalid date

    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")} ${timePart}`;
}

/**
 * Upserts a page of CFTS records into Postgres.
 * @param {Array<object>} cfts
 * @returns {Promise<void>}
 */
async function upsertCFTS(cfts) {
    if (!cfts || cfts.length === 0) return;

    const values = [];
    const placeholders = [];

    cfts.forEach((cft, idx) => {
        const verte =
            Number(cft.numatomaBendraPirkimoVerte?.replace(/,/g, "")) || null;

        values.push(
            cft.pavadinimas,
            cft.pirkimoId,
            cft.pirkimoVykdytojas,
            cft.informacija,
            cft.paskelbimoData,
            cft.pasiulymuPateikimoTerminas,
            cft.pirkimoBudas,
            cft.statusas,
            verte,
            cft.zingsnis,
            cft.type,
        );
        const offset = idx * 11; // 11 columns
        placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`,
        );
    });

    const query = `
        INSERT INTO "viesiejiPirkimai"
        ("pavadinimas", "pirkimoId", "pirkimoVykdytojas", "informacija", "paskelbimoData", "pasiulymuPateikimoTerminas", "pirkimoBudas", "statusas", "numatomaBendraPirkimoVerte", "zingsnis", "type")
        VALUES ${placeholders.join(", ")}
        ON CONFLICT ("pirkimoId") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas",
            "pirkimoVykdytojas" = EXCLUDED."pirkimoVykdytojas",
            "informacija" = EXCLUDED."informacija",
            "paskelbimoData" = EXCLUDED."paskelbimoData",
            "pasiulymuPateikimoTerminas" = EXCLUDED."pasiulymuPateikimoTerminas",
            "pirkimoBudas" = EXCLUDED."pirkimoBudas",
            "statusas" = EXCLUDED."statusas",
            "numatomaBendraPirkimoVerte" = EXCLUDED."numatomaBendraPirkimoVerte",
            "zingsnis" = EXCLUDED."zingsnis",
            "type" = EXCLUDED."type";
    `;

    await postgres.query(query, values);
}

/**
 * Fetches and upserts all CFTS pages with rate-limited parallel requests.
 * @param {object} [options]
 * @param {number} [options.pageSize=1000] - Records per page.
 * @param {number} [options.concurrency=5] - Max concurrent requests.
 * @param {number} [options.requestsPerSecond=5] - Rate limit for requests.
 * @returns {Promise<void>}
 */
export async function updateCFTS(options = {}) {
    const puslapyje = options.pageSize ?? PAGE_SIZE;
    const concurrency = options.concurrency ?? 5;
    const requestsPerSecond = options.requestsPerSecond ?? 5;
    let nextPage = 1;
    let stop = false;
    let firstError = null;

    const queue = new PQueue({
        concurrency,
        intervalCap: requestsPerSecond,
        interval: 1000,
        carryoverConcurrencyCount: true,
    });

    const abortController = new AbortController();

    const fetchPage = async (page) => {
        const timings = new Timings();
        const url = `${config.viesiejiPirkimaiUrl}/epps/viewCFTSAction.do?T01_ps=${puslapyje}&d-3680175-p=${page}`;
        // d-3680175-p=2 // page 2

        timings.start("fetch");
        const response = await fetch(url, { signal: abortController.signal });
        const html = await response.text();
        timings.end("fetch");

        const { document } = parseHTML(html);

        const rows = document.querySelector("#T01 > tbody");
        const rowsCount = rows?.children?.length ?? 0;
        if (!rows || rowsCount === 0) {
            timings.start("upsert");
            timings.end("upsert");
            timings.end("all");
            log(
                `Page ${page} fetched+upserted in ${timings.humanDuration()} (fetch ${timings.humanDuration("fetch")}, upsert ${timings.humanDuration("upsert")}, ${rowsCount} rows)`,
            );
            stop = true;
            queue.clear();
            abortController.abort();
            return;
        }

        const pageCfts = [];
        for (const row of rows.children) {
            const tds = row.querySelectorAll("td");
            if (tds.length < 13) continue;

            const cft = {};

            cft.pavadinimas =
                tds[1].querySelector("a")?.textContent?.trim() ?? null;

            cft.pirkimoId = tds[2].textContent?.trim() ?? null;

            cft.pirkimoVykdytojas = tds[3].textContent?.trim() ?? null;

            cft.informacija =
                tds[4].querySelector("img")?.getAttribute("title")?.trim() ??
                null;

            cft.paskelbimoData = tds[5].textContent?.trim() ?? null;

            cft.pasiulymuPateikimoTerminas = tds[6].textContent?.trim() ?? null;

            cft.pirkimoBudas = tds[7].textContent?.trim() ?? null;

            cft.statusas = tds[8].textContent?.trim() ?? null;

            cft.numatomaBendraPirkimoVerte =
                tds[11].textContent?.replace(/,/g, "")?.trim() ?? null;

            cft.zingsnis = tds[12].textContent?.trim() ?? null;

            const href = tds[1].querySelector("a")?.getAttribute("href") ?? "";
            const typeMatch = href.match(
                /\/epps\/(?:cft\/prepareView|pmc\/view|dps\/prepareView)([A-Za-z]+)\.do/,
            );

            if (!typeMatch) {
                throw new Error(`Unexpected href format: ${href}`);
            }

            cft.type = typeMatch[1];

            cft.paskelbimoData = formatPgDate(tds[5].textContent?.trim());
            cft.pasiulymuPateikimoTerminas = formatPgDate(
                tds[6].textContent?.trim(),
            );

            pageCfts.push(cft);
        }

        timings.start("upsert");
        if (pageCfts.length) {
            await upsertCFTS(pageCfts);
        }
        timings.end("upsert");
        timings.end("all");

        log(
            `Page ${page} fetched+upserted in ${timings.humanDuration()} (fetch ${timings.humanDuration("fetch")}, upsert ${timings.humanDuration("upsert")}, ${rowsCount} rows)`,
        );

        if (!stop) enqueueNext();
    };

    const enqueueNext = () => {
        if (stop) return;
        const page = nextPage;
        nextPage += 1;
        queue
            .add(() => fetchPage(page))
            .catch((error) => {
                if (error?.name === "AbortError") return;
                if (!firstError) firstError = error;
                stop = true;
                queue.clear();
                abortController.abort();
            });
    };

    for (let i = 0; i < concurrency; i += 1) {
        enqueueNext();
    }

    await queue.onIdle();

    if (firstError) throw firstError;

    return;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    await updateCFTS();
    await postgres.end();
}
