/*
Parsiunčia ir įdeda į duomenų bazę neskelbiamas derybas iš eviesiejipirkimai.lt
*/

import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("neskelbiamosDerybos", { operation: "scrape" });
import { log } from "../../utils/log.js";
import { postgres } from "../../postgres/postgres.js";
import { getProxyBySite } from "../scrapeProxies/getProxyBySite.js";
import { irasytiFailus } from "../failai/failuIrasymas.js";
import { parseHTML } from "linkedom";
import crypto from "crypto";

/**
 * Nuskaityti neskelbiamas derybas nuo nurodyto puslapio
 * @param {number} start Puslapio numeris (0, 1, 2, ...)
 * @returns {Promise<Array>} Grąžina neskelbiamas derybas
 */
async function nuskaitytiNeskelbiamasDerybasNuo(start = 0) {
    let proxy = await getProxyBySite("eviesiejipirkimai");

    let url = `/index.php?option=com_profile&task=sutikimai&filter_limit=50&Itemid=98&limitstart=${start * 50}`;
    let requestUrl;
    if (proxy) {
        requestUrl = proxy.url + url;
    } else {
        requestUrl = "https://eviesiejipirkimai.lt" + url;
    }

    let startTime = new Date();

    // Atliekama užklausa
    var response = await scrapeFetch(requestUrl, {
        headers: {
            "User-Agent":
                "Pilietine iniciatyva Viespirkiai <viespirkiai@viespirkiai.org>",
        },
    });

    const html = await response.text();

    log(`Užklausos laikas: ${((new Date() - startTime) / 1000).toFixed(2)}s`);

    // Nuskaitomas HTML
    const { document } = parseHTML(html);

    let items = document.querySelectorAll(`.vptpublic_main`);
    log(`Rasta įrašų: ${items.length}`);

    let neskelbiamosDerybos = [];

    for (let item of items) {
        let neskelbiamaDeryba = {
            jarKodas: item
                .querySelectorAll("td")[1]
                .textContent.trim()
                .match(/\d{9}/)?.[0],
            jarPavadinimas: item
                .querySelectorAll("td")[1]
                .querySelector("a")
                .textContent.trim(),
            aprasymas: item
                .querySelector(".float-right[align='right']")
                .textContent.trim(),
            data: item.querySelectorAll("td")[2].textContent.trim(),
            link: item.querySelectorAll("td")[3].querySelector("a").href,
            isvada: item
                .querySelectorAll("td")[3]
                .querySelector("a")
                .textContent.trim(),
        };

        // Generate an 8 character MD5 hash for the object basing on aprasymas + isvada
        neskelbiamaDeryba.hash = crypto
            .createHash("md5")
            .update(neskelbiamaDeryba.aprasymas + neskelbiamaDeryba.isvada)
            .digest();

        const base32Chars = "abcdefghijklmnopqrstuvwxyz234567";
        neskelbiamaDeryba.hash = Array.from(neskelbiamaDeryba.hash)
            .map((b) => base32Chars[b >> 3])
            .join("")
            .substring(0, 8);

        neskelbiamosDerybos.push(neskelbiamaDeryba);
    }

    log(`Iš viso nuskaityta neskelbiamų derybų: ${neskelbiamosDerybos.length}`);
    return neskelbiamosDerybos;
}

/**
 * Nuskaityti visas neskelbiamas derybas ir įdėti į duomenų bazę
 */
export async function nuskaitytiVisasNeskelbiamasDerybas() {
    let page = 0;
    let allDerybos = [];

    while (true) {
        let derybos = await nuskaitytiNeskelbiamasDerybasNuo(page);
        if (derybos.length === 0) {
            break;
        }
        allDerybos = allDerybos.concat(derybos);
        page++;
    }

    const seen = new Set();
    allDerybos = allDerybos.filter((d) => {
        if (seen.has(d.hash)) return false;
        seen.add(d.hash);
        return true;
    });

    if (allDerybos.length > 0) {
        const columns = [
            "jarKodas",
            "jarPavadinimas",
            "aprasymas",
            "data",
            "link",
            "isvada",
            "hash",
        ];

        // Flatten all values into a single array for parameterized query
        const values = [];
        const placeholders = allDerybos
            .map((d, i) => {
                const start = i * columns.length + 1;
                values.push(d.jarKodas || null);
                values.push(d.jarPavadinimas || null);
                values.push(d.aprasymas || null);
                values.push(d.data || null);
                values.push(d.link || null);
                values.push(d.isvada || null);
                values.push(d.hash);
                return `(${columns.map((_, j) => `$${start + j}`).join(", ")})`;
            })
            .join(", ");

        const query = `
            INSERT INTO public."neskelbiamosDerybos"
            (${columns.map((c) => `"${c}"`).join(", ")})
            VALUES ${placeholders}
            ON CONFLICT ("hash") DO UPDATE SET
                "jarKodas" = EXCLUDED."jarKodas",
                "jarPavadinimas" = EXCLUDED."jarPavadinimas",
                "aprasymas" = EXCLUDED."aprasymas",
                "data" = EXCLUDED."data",
                "link" = EXCLUDED."link",
                "isvada" = EXCLUDED."isvada"
        `;

        await postgres.query(query, values);

        const failai = [];
        allDerybos.forEach((deryba) => {
            failai.push({
                saltinis: "neskelbiamosDerybos",
                saltinioId: deryba.link.replace(
                    "https://eviesiejipirkimai.lt/sutikimai_laikini/",
                    "",
                ),
                pavadinimas: deryba.link.split("/").pop().split("?")[0],
                extension: deryba.link
                    .split("/")
                    .pop()
                    .split("?")[0]
                    .split(".")
                    .pop(),
            });
        });

        // Dublikatus atmeta files unikalūs indeksai (žr. failuIrasymas.js).
        await irasytiFailus(failai);
    }
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    nuskaitytiVisasNeskelbiamasDerybas()
        .then(() => {
            log("Nuskaitymas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida nuskaitant:", err);
            postgres.end();
        });
}
