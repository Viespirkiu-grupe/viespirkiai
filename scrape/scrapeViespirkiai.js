/*
Periodiškai atsiunčia ir importuoja sutartis iš eViesiejiPirkimai.lt svetainės.
*/
import { parseHTML } from "linkedom";
import { writeFile } from "fs/promises";
import { importArray } from "../import/import.js";
import fetch from "node-fetch";
import pkg from "https-proxy-agent";
const { HttpsProxyAgent } = pkg;
import { SocksProxyAgent } from "socks-proxy-agent";
import config from "../utils/config.js";
import { log } from "../utils/log.js";

// Nustatome proxy, jei yra
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
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
                    "AppleWebKit/537.36 (KHTML, like Gecko) " +
                    "Chrome/115.0.0.0 Safari/537.36",
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
                    sutartis.bvpzKodas = tr
                        .querySelectorAll("td")[1]
                        .querySelector("a").innerHTML;
                    sutartis.bvpzPavadinimas = ((td) => {
                        td.querySelector("a")?.remove();
                        return td.textContent.trim();
                    })(tr.querySelectorAll("td")[1]);
                } catch (e) {
                    let galimaiKodas = tr.querySelectorAll("td")[1].innerHTML;
                    if (
                        galimaiKodas.match(/^[0-9-]+$/) ||
                        galimaiKodas.length < 15
                    ) {
                        sutartis.bvpzKodas = galimaiKodas;
                        sutartis.bvpzPavadinimas = "";
                    } else {
                        if (
                            tr.innerHTML.match(
                                /<td class="text-end"><i><b>BVPŽ kodas:<\/b><\/i><\/td><td>(.*)<\/td>/,
                            )
                        ) {
                            sutartis.bvpzKodas = undefined;
                            sutartis.bvpzPavadinimas = tr.innerHTML.match(
                                /<td class="text-end"><i><b>BVPŽ kodas:<\/b><\/i><\/td><td>(.*)<\/td>/,
                            )[1];
                        } else if (galimaiKodas.match(/^[0-9]{8}-[0-9]$/)) {
                            sutartis.bvpzKodas = galimaiKodas;
                            sutartis.bvpzPavadinimas = "";
                        }
                    }
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

        sutartys.push(sutartis);
    }

    return sutartys;
}

/**
 * Importuoja sutartis iš eViesiejiPirkimai.lt svetainės pagal nurodytą puslapį.
 * @param {number} page - Puslapis, kurį reikia importuoti
 * @returns {number} Importuotų įrašų skaičius
 */
async function importPage(page = 0) {
    let start = new Date();

    // Sudarome puslapio URL
    let limitstart = page * 50; // Puslapiuose yra po 50 įrašų, todėl dauginame iš 50

    let kiekis = 49; // Valstybinė magija – paprašai 50, gausi 51
    if (page == 0) {
        kiekis = 50; // ... išskyrus pirmame puslapyje
    }

    const url = `https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&filter_limit=${kiekis}&order_field=date&order_dir=asc&limitstart=${limitstart}`;
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

    return data.length;
}

/**
 * Atsiunčia naujausias sutartis iš eViesiejiPirkimai.lt svetainės.
 * @returns {Promise}
 */
export async function requestLatestEviesiejipirkimaiData() {
    // Nuskaitome paskutinio puslapio numerį iš ./taskState/scrapeEviesiejipirkimaiSutartys.txt
    try {
        const lastPageFile = await import("fs/promises").then((fs) =>
            fs.readFile(
                "./taskState/scrapeEviesiejipirkimaiSutartys.txt",
                "utf-8",
            ),
        );
        var page = parseInt(lastPageFile.trim(), 10) + 1;
        if (isNaN(page)) page = 0;
    } catch (error) {
        var page = 0;
    }

    // Siunčiame puslapius tol, kol yra duomenų
    while (true) {
        if ((await importPage(page)) < 50) {
            log(`Puslapis ${page} nėra pilnas.`);
            return false;
        } else {
            log(`Puslapis ${page} pilnas.`);

            // Išsaugome puslapio numerį į ./taskState/scrapeEviesiejipirkimaiSutartys.txt
            await writeFile(
                "./taskState/scrapeEviesiejipirkimaiSutartys.txt",
                page.toString(),
            );
            page++;
        }
        // Wait for like 1s
        await new Promise((resolve) => setTimeout(resolve, 1));
    }
}
