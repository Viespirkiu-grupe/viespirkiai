/*
Duomenų iš eViesiejiPirkimai.lt nuskaitymas (scrapinimas)
Kaip argumentą galima pateikti puslapio numerį, nuo kurio pradėti nuskaitymą.
*/

import { parseHTML } from "linkedom";
import { postgres } from "../../postgres/postgres.js";
import { importArray } from "./import.js";
import fetch from "node-fetch";
import pkg from "https-proxy-agent";
const { HttpsProxyAgent } = pkg;
import { SocksProxyAgent } from "socks-proxy-agent";
import config from "../../utils/config.js";
import { log } from "../../utils/log.js";
import { DateTime } from "luxon";

// Naudojame proxy, jei yra
let proxyAgent = null;

if (config.scrapeProxy) {
    if (
        config.scrapeProxy.startsWith("http://") ||
        config.scrapeProxy.startsWith("https://")
    ) {
        proxyAgent = new HttpsProxyAgent(config.scrapeProxy, {
            rejectUnauthorized: false, // allow self-signed certs
        });
    } else if (
        config.scrapeProxy.startsWith("socks5://") ||
        config.scrapeProxy.startsWith("socks://")
    ) {
        proxyAgent = new SocksProxyAgent(config.scrapeProxy, {
            rejectUnauthorized: false,
        });
    } else {
        throw new Error("Unsupported proxy protocol: " + config.scrapeProxy);
    }
}

/**
 * Parsisiunčia ir nuskaito sutartis iš eViesiejiPirkimai.lt svetainės.
 * @param {string} url
 * @returns {Promise<Object[]>} Sutartys
 */
export async function scrapePage(url) {
    let start = new Date();

    // Atliekama užklausa
    if (proxyAgent) {
        var response = await fetch(url, {
            agent: proxyAgent,
            headers: {
                "User-Agent":
                    "Viespirkiai.top nuskaitymas +<viespirkiai@viespirkiai.top>",
                Accept:
                    "text/html,application/xhtml+xml,application/xml;" +
                    "q=0.9,image/webp,image/apng,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Accept-Encoding": "gzip, deflate, br",
                Connection: "keep-alive",
            },
        });
    } else {
        var response = await fetch(url);
    }
    const html = await response.text();

    log(`Užklausos laikas: ${((new Date() - start) / 1000).toFixed(2)}s`);

    // Nuskaitomas HTML
    const { document } = parseHTML(html);

    // Check if document contains a h2 containing text "Vykdomi sistemos atnaujinimo darbai"
    if (
        [...document.querySelectorAll("h2")].some((h2) =>
            h2.textContent.includes("Vyksta sistemos atnaujinimo darbai"),
        )
    ) {
        log(`Svetainėje vykdomi sistemos atnaujinimo darbai`);
        await postgres.query(
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
                "sistemosAtnaujinimoDarbai",
            ],
        );
        throw new Error("Svetainėje vykdomi sistemos atnaujinimo darbai");
    } else if (!document.querySelector("#lenetele_table")) {
        log(`Nerasta lentelė`);
        await postgres.query(
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
                "nerastaLentele",
            ],
        );
        throw new Error("Nerasta lentelė");
    }

    const table = document.querySelector("#lenetele_table");
    const rows = [...table.querySelectorAll("tr")];

    const result = [];
    let collecting = false;

    // Nuskaitome duomenis
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!collecting) {
            if (row.id === "topRow") {
                collecting = true;
            }
            continue;
        }

        const mainMatch = row.id?.match(/^vptpublic_main_(\d+)$/);
        if (mainMatch) {
            const id = mainMatch[1];
            const nextRow = rows[i + 1];
            const extraMatch = nextRow?.id === `vptpublic_extra_${id}`;
            if (extraMatch) {
                result.push([row, nextRow]);
                i++;
            }
        }
    }

    // Sujungiame informaciją į sutartis
    let sutartys = [];

    for (const [mainRow, extraRow] of result) {
        let sutartis = {
            tipas: mainRow.querySelectorAll("td")[1].querySelector("a")
                .innerHTML,
            pavadinimas: mainRow
                .querySelectorAll("td")[1]
                .querySelector("a")
                .innerHTML.trimEnd(),
            kategorija: mainRow
                .querySelectorAll("td")[1]
                .querySelector(".ProcurementType").innerHTML,
            perkanciojiOrganizacija:
                mainRow.querySelectorAll("td")[2].querySelector("a")
                    ?.innerHTML ?? "",
            perkanciosiosOrganizacijosKodas:
                mainRow.querySelectorAll("td")[2].querySelectorAll("a")[1]
                    ?.innerHTML ?? "",
            tiekejas:
                mainRow
                    .querySelectorAll("td")[3]
                    .querySelector("a")
                    ?.innerHTML.trimEnd() ?? "",
            tiekejoKodas:
                mainRow.querySelectorAll("td")[3].querySelectorAll("a")[1]
                    ?.innerHTML ?? "",
            verte: mainRow
                .querySelectorAll("td")[4]
                .innerHTML.replace("€", "")
                .replace(/\./g, "")
                .replace(/,/g, "."),
            sudarymoData: mainRow.querySelectorAll("td")[5].innerHTML,
            galiojimoData: mainRow.querySelectorAll("td")[6].innerHTML,
            faktineIvykdimoVerte: mainRow
                .querySelectorAll("td")[7]
                .innerHTML.replace("&#160;", "")
                .replace("€", "")
                .replace(/\./g, "")
                .replace(/,/g, "."),
            faktineIvykdimoData: mainRow
                .querySelectorAll("td")[8]
                .innerHTML.replace("&#160;", ""),
            tipas: mainRow.querySelectorAll("td")[9].innerHTML,
            dokumentai: [],
            dokumentuKiekis: 0,
        };

        sutartis.papildomiTiekejai = [];
        sutartis.papildomiTiekejaiKodai = [];

        let papildomiTiekejaiTD = mainRow.querySelectorAll("td")[3];
        let papildomiTiekejaiLinks = papildomiTiekejaiTD.querySelectorAll("a");
        for (let j = 2; j < papildomiTiekejaiLinks.length; j += 2) {
            let tiekejas = papildomiTiekejaiLinks[j].innerHTML.trimEnd();
            let tiekejoKodas = papildomiTiekejaiLinks[j + 1].innerHTML;
            sutartis.papildomiTiekejai.push(tiekejas);
            sutartis.papildomiTiekejaiKodai.push(tiekejoKodas);
        }

        let ekstriniaiDuomenys = extraRow
            .querySelector("table")
            .querySelectorAll("tr");
        ekstriniaiDuomenys.forEach((tr) => {
            let tekstas = tr.innerHTML;
            if (tekstas.includes("Paskelbimo data")) {
                sutartis.paskelbimoData =
                    tr.querySelectorAll("td")[1].querySelector("span")
                        ?.innerHTML ?? "";

                if (tekstas.includes("atnaujinimo data")) {
                    sutartis.paskutinioAtnaujinimoData = tr
                        .querySelectorAll("td")[1]
                        .querySelector("span")
                        .title.replace("Paskutinio atnaujinimo data ", "");
                }
            } else if (tekstas.includes("BVPŽ kodas")) {
                try {
                    const td = tr.querySelectorAll("td")[1];
                    const nodes = Array.from(td.childNodes);

                    sutartis.papildomiBvpzKodai = [];
                    sutartis.papildomiBvpzPavadinimai = [];

                    if (nodes.length > 0) {
                        // Find first <a>
                        let firstLinkIndex = nodes.findIndex(
                            (n) => n.nodeName === "A",
                        );
                        if (firstLinkIndex >= 0) {
                            sutartis.bvpzKodas =
                                nodes[firstLinkIndex].textContent.trim();
                            sutartis.bvpzPavadinimas = nodes
                                .slice(0, firstLinkIndex)
                                .map((n) => n.textContent)
                                .join(" ")
                                .trim();

                            // Any additional codes/names
                            for (
                                let i = firstLinkIndex + 1;
                                i < nodes.length;
                                i++
                            ) {
                                if (nodes[i].nodeName === "A") {
                                    sutartis.papildomiBvpzKodai.push(
                                        nodes[i].textContent.trim(),
                                    );

                                    // Name is text node **before** this <a>
                                    let prevText = "";
                                    for (let j = i - 1; j >= 0; j--) {
                                        if (
                                            nodes[j].nodeType === 3 &&
                                            nodes[j].textContent.trim()
                                        ) {
                                            // text node
                                            prevText =
                                                nodes[j].textContent.trim();
                                            break;
                                        }
                                    }
                                    sutartis.papildomiBvpzPavadinimai.push(
                                        prevText,
                                    );
                                }
                            }
                        } else {
                            // No <a> found
                            sutartis.bvpzKodas = "";
                            sutartis.bvpzPavadinimas = td.textContent.trim();
                        }
                    }
                } catch (e) {
                    sutartis.papildomiBvpzKodai = [];
                    sutartis.papildomiBvpzPavadinimai = [];
                    sutartis.bvpzKodas = "";
                    sutartis.bvpzPavadinimas = "";
                }
            } else if (tekstas.includes("Paskutinio redagavimo data")) {
                sutartis.paskutinioRedagavimoData =
                    tr.querySelectorAll("td")[1].innerHTML;
            } else if (tekstas.includes("Sutarties unikalus ID")) {
                sutartis.sutartiesUnikalusID =
                    tr.querySelectorAll("td")[1].innerHTML;
            } else if (tekstas.includes("Sutarties numeris")) {
                sutartis.sutartiesNumeris =
                    tr.querySelectorAll("td")[1].innerHTML;
            } else if (tekstas.includes("Pirkimo numeris")) {
                sutartis.pirkimoNumeris =
                    tr.querySelectorAll("td")[1].innerHTML;
            } else if (tekstas.includes("Dokumentai")) {
                let dokumentuLink = tr
                    .querySelectorAll("td")[1]
                    .querySelectorAll("a");

                dokumentuLink.forEach((link) => {
                    sutartis.dokumentai.push({
                        pavadinimas: link.innerHTML,
                        url: "https://eviesiejipirkimai.lt" + link.href,
                    });
                });

                sutartis.dokumentuKiekis = dokumentuLink.length;
            } else {
                throw new Error("Nerastas laukelis: " + tr.innerHTML);
            }
        });

        sutartis.paskutiniKartaMatyta = new Date().toLocaleString("lt-LT", {
            timeZone: "Europe/Vilnius",
        });

        sutartys.push(sutartis);
    }

    return sutartys;
}

/**
 * Importuoja sutartis iš eViesiejiPirkimai.lt svetainės pagal nurodytą puslapį.
 * @param {number} page - Puslapis, kurį reikia importuoti
 * @returns {Promise<number>} Importuotų sutarčių skaičius
 */
async function importPage(page = 0) {
    let start = new Date();

    // Sudarome puslapio URL
    let limitstart = page * 50; // Puslapiuose yra po 50 įrašų, todėl dauginame iš 50

    let kiekis = 50;

    const url = `https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&filter_limit=${kiekis}&limitstart=${limitstart}`;
    log(`Importuojamas puslapis ${page} ${url}`);

    // Nuskaitome puslapį
    let data = await scrapePage(url);

    // Jei nėra duomenų, grąžina 0
    if (data.length === 0) {
        log(`Nėra įrašų`);
        return 0;
    }

    // Importuojame duomenis į duomenų bazę
    await importArray(data);

    log(
        `Puslapio ${page} importas užtruko ${((new Date() - start) / 1000).toFixed(2)}s.`,
    );
    log(`Importuotos ${data.length} sutartys.`);

    let naujausioAtnaujinimoTimestamp = data
        .map((d) => d.paskutinioRedagavimoData)
        .sort()
        .pop();

    return {
        length: data.length,
        naujausioAtnaujinimoTimestamp,
    };
}

/**
 * Atsiunčia naujausias sutartis iš eViesiejiPirkimai.lt svetainės.
 * @returns {Promise}
 */
export async function requestLatestEviesiejipirkimaiData() {
    let naujausioAtnaujinimoTimestampRes = await postgres.query(
        `SELECT max("paskutinioRedagavimoData") FROM sutartys;`,
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

    for (let page = 0; page < 50; page++) {
        let data = await importPage(page);

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

        log(`Importuotas puslapis ${page}`);
    }
    return false;
}

export async function scrapePagesStarting(page = 0) {
    let yraIrasu = true;
    while (yraIrasu) {
        let data = await importPage(page);
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

export async function scrapePagesSequential(startPage = 0, batchSize = 20) {
    let page = startPage;
    let yraIrasu = true;

    while (yraIrasu) {
        let batchResults;
        while (true) {
            try {
                const batchPromises = [];
                for (let i = 0; i < batchSize; i++) {
                    const limitstart = (page + i) * 50;
                    const url = `https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&filter_limit=50&limitstart=${limitstart}`;
                    log(`Scraping page ${page + i} ${url}`);
                    batchPromises.push(scrapePage(url));
                }

                batchResults = await Promise.all(batchPromises);
                break; // success, exit loop
            } catch (err) {
                log(`Batch failed, retrying in 60s: ${err}`);
                await new Promise((res) => setTimeout(res, 60000));
            }
        }

        const batchData = batchResults.flat();

        if (batchData.length === 0) {
            yraIrasu = false;
            log("No more records, scraping finished.");
        } else {
            // wait for DB insert before continuing
            await importArray(batchData);

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
    scrapePagesSequential(page).then(() => {
        log("Baigtas visų puslapių nuskaitymas.");
        process.exit(0);
    });
}
