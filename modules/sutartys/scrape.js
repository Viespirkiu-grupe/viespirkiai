/*
Duomenų iš eViesiejiPirkimai.lt nuskaitymas (scrapinimas)
Kaip argumentą galima pateikti puslapio numerį, nuo kurio pradėti nuskaitymą.
*/

import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("sutartys", { operation: "scrape" });
import { postgres } from "../../postgres/postgres.js";
import { getProxyBySite } from "../scrapeProxies/getProxyBySite.js";
import { cvpIsImportArray } from "./import.js";
import { log } from "../../utils/log.js";
import { DateTime } from "luxon";
import Timings from "../../utils/timings.js";
import { parseSutartysHtmlInWorker } from "./parsePageInWorker.js";

function recordCvpIsFailure(tipas) {
    return postgres.query(
        `INSERT INTO "eviesiejipirkimaiGedimai" ("timestamp", "tipas") VALUES ($1, $2);`,
        [
            new Date().toLocaleString("lt-LT", {
                timeZone: "Europe/Vilnius",
                year: "numeric",
                month: "2-digit",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
            }),
            tipas,
        ],
    );
}

/**
 * Parsisiunčia ir nuskaito sutartis iš eViesiejiPirkimai.lt svetainės.
 * @param {string} url
 * @returns {Promise<Object[]>} Sutartys
 */
export async function cvpIsScrapePageContent(url, options = {}) {
    let timings = options.timings || new Timings();
    timings.start("cvpIsScrapePageContent");

    timings.start("findProxy");
    let proxy = options.useProxy === false
        ? null
        : await getProxyBySite("eviesiejipirkimai");

    let requestUrl = url;
    if (proxy) {
        const urlObj = new URL(url);
        const proxyUrlObj = new URL(proxy.url);
        urlObj.host = proxyUrlObj.host;
        urlObj.protocol = proxyUrlObj.protocol;
        requestUrl = urlObj.toString();
    }
    timings.end("findProxy");

    timings.start("cvpIsRequest");
    var response = await scrapeFetch(requestUrl, {
        headers: {
            "User-Agent":
                "Pilietine iniciatyva Viespirkiai +<viespirkiai@viespirkiai.org>",
            Accept:
                "text/html,application/xhtml+xml,application/xml;" +
                "q=0.9,image/webp,image/apng,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            Connection: "keep-alive",
        },
    });

    if (response.status === 403) {
        if (options.recordFailures !== false) {
            timings.start("insertCvpIsGedimai");
            await recordCvpIsFailure("403");
            timings.end("insertCvpIsGedimai");
        }
        throw new Error("Gauta 403 klaida, užklausa blokuojama");
    }

    const htmlBuffer = await response.arrayBuffer();
    timings.end("cvpIsRequest");

    timings.start("parseHtml");
    const parsed = await parseSutartysHtmlInWorker(htmlBuffer);
    timings.end("parseHtml");

    if (parsed.status === "maintenance") {
        log(`Svetainėje vykdomi sistemos atnaujinimo darbai`);
        if (options.recordFailures !== false) {
            timings.start("insertCvpIsGedimai");
            await recordCvpIsFailure("sistemosAtnaujinimoDarbai");
            timings.end("insertCvpIsGedimai");
        }
        throw new Error("Svetainėje vykdomi sistemos atnaujinimo darbai");
    }
    if (parsed.status === "missing-table") {
        log(`Nerasta lentelė`);
        if (options.recordFailures !== false) {
            timings.start("insertCvpIsGedimai");
            await recordCvpIsFailure("nerastaLentele");
            timings.end("insertCvpIsGedimai");
        }
        throw new Error("Nerasta lentelė");
    }

    const { sutartys, total } = parsed;

    timings.end("cvpIsScrapePageContent");
    return { sutartys, total, timings };
}

/**
 * Importuoja sutartis iš eViesiejiPirkimai.lt svetainės pagal nurodytą puslapį.
 * @param {number} page - Puslapis, kurį reikia importuoti
 * @returns {Promise<number>} Importuotų sutarčių skaičius
 */
async function cvpIsScrapePage(page = 0, options = {}) {
    let timings = options.timings || new Timings();
    timings.start("cvpIsScrapePage");

    // Sudarome puslapio URL
    let limitstart = page * 50; // Puslapiuose yra po 50 įrašų, todėl dauginame iš 50

    let kiekis = 50;

    const url = `https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&filter_limit=${kiekis}&limitstart=${limitstart}`;
    log(`Importuojamas puslapis ${page} ${url}`);

    // Nuskaitome puslapį
    let sutartys;
    ({ sutartys, timings } = await cvpIsScrapePageContent(url, { timings }));

    // Jei nėra duomenų, grąžina 0
    if (sutartys.length === 0) {
        log(`Nėra įrašų`);
        return 0;
    }

    // Importuojame duomenis į duomenų bazę
    ({ timings } = await cvpIsImportArray(sutartys, { timings }));
    timings.end("cvpIsScrapePage");

    log(
        `Puslapio ${page} atnaujinimas užtruko ${timings.humanDuration("cvpIsScrapePage")}, ${sutartys.length} sut.`,
    );

    let naujausioAtnaujinimoTimestamp = sutartys
        .map((d) => d.paskutinioRedagavimoData)
        .sort()
        .pop();

    return {
        length: sutartys.length,
        naujausioAtnaujinimoTimestamp,
        timings,
    };
}

/**
 * Atsiunčia naujausias sutartis iš eViesiejiPirkimai.lt svetainės.
 * @returns {Promise}
 */
export async function cvpIsRequestLatest(options = {}) {
    let timings = options.timings || new Timings();
    timings.start("cvpIsNewestTimestamp");
    // WHERE istrinta = false, kad naudotų dalinį vpmSutartys_redagavimoData_idx
    let naujausioAtnaujinimoTimestampRes = await postgres.query(
        `SELECT max("redagavimoData") FROM public."vpmSutartys"
         WHERE istrinta = false;`,
    );
    let naujausioAtnaujinimoTimestamp =
        naujausioAtnaujinimoTimestampRes.rows[0].max; // String formatas "YYYY-MM-DD HH:MM:SS"

    if (!naujausioAtnaujinimoTimestamp) {
        naujausioAtnaujinimoTimestamp = "1970-01-01 00:00:00";
    }

    naujausioAtnaujinimoTimestamp = DateTime.fromSQL(
        naujausioAtnaujinimoTimestamp,
        {
            zone: "Europe/Vilnius",
        },
    );
    timings.end("cvpIsNewestTimestamp");

    for (let page = 0; page < 50; page++) {
        timings.start("cvpIsRequestLatest");
        let data = await cvpIsScrapePage(page, { timings });
        timings = data.timings;

        // Patikriname ar data.naujausioAtnaujinimoTimestamp yra bent 15min senesnis už naujausioAtnaujinimoTimestamp
        // Jei taip, stabdome importą, jau atsikasėme viską
        if (
            DateTime.fromJSDate(data.naujausioAtnaujinimoTimestamp).plus({
                minutes: 15,
            }) < naujausioAtnaujinimoTimestamp
        ) {
            log(
                `Sustabdomas importas, nes pasiektas 15min senesnis įrašas nei naujausias duomenų bazėje.`,
            );
            return false;
        }

        timings.end("cvpIsRequestLatest");
        log(
            `Importuotas puslapis ${page} per ${timings.humanDuration("cvpIsRequestLatest")}, naujausias atnaujinimas: ${data.naujausioAtnaujinimoTimestamp}`,
        );
    }
    return false;
}

export async function cvpIsScrapePagesStarting(page = 0) {
    let yraIrasu = true;
    while (yraIrasu) {
        let data = await cvpIsScrapePage(page);
        if (data.length === 0) {
            yraIrasu = false;
            log(`Nėra daugiau įrašų, baigiamas nuskaitymas.`);
        } else {
            log(
                `Importuotas puslapis ${page}, atkasta iki ${data.naujausioAtnaujinimoTimestamp}`,
            );
            page++;
        }
    }
}

export async function cvpIsScrapePagesSequential(
    startPage = 0,
    batchSize = 20,
) {
    let page = startPage;
    let yraIrasu = true;

    while (yraIrasu) {
        while (true) {
            try {
                const batchPromises = [];
                for (let i = 0; i < batchSize; i++) {
                    const limitstart = (page + i) * 50;
                    const url = `https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&filter_limit=50&limitstart=${limitstart}`;
                    log(`Scraping page ${page + i} ${url}`);
                    batchPromises.push(cvpIsScrapePageContent(url));
                }

                var batchData = await Promise.all(batchPromises);
                break; // success, exit loop
            } catch (err) {
                log(`Batch failed, retrying in 60s: ${err}`);
                await new Promise((res) => setTimeout(res, 60000));
            }
        }

        if (batchData.length === 0) {
            yraIrasu = false;
            log("No more records, scraping finished.");
        } else {
            // wait for DB insert before continuing
            await cvpIsImportArray(batchData);

            const latestTimestamp = batchData
                .map((d) => d.paskutinioRedagavimoData)
                .sort()
                .pop();

            log(
                `Imported batch ending with page ${page + batchSize - 1}, latest update: ${latestTimestamp}, total contracts: ${batchData.length}`,
            );

            page += batchSize;
        }
    }
}

// If ran directly, scrapePagesStarting given the argument
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    let page = 0;
    if (process.argv.length >= 3) {
        page = parseInt(process.argv[2]);
    }
    cvpIsScrapePagesSequential(page).then(() => {
        log("Baigtas visų puslapių nuskaitymas.");
        process.exit(0);
    });
}
