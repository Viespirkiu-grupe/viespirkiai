/*
Parsiunčia bylų metaduomenis iš Liteko sistemos ir įterpia jas į Postgres duomenų bazę.
*/

import { parseHTML } from "linkedom";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

/**
 * Nuskaito bylas iš Liteko sistemos nurodytai dienai.
 * @param {Date|string} data - Data, kurios bylas reikia nuskaityti (Date objektas arba "YYYY-MM-DD" formatas).
 * @returns {Promise<Array|boolean>} - Grąžina masyvą bylų objektų arba false, jei nėra rezultatų.
 */
async function nuskaitytiDiena(data) {
    let startTime = new Date();

    let dataNuo = new Date(data);
    dataNuo = dataNuo.toISOString().split("T")[0] + " 00:00:00";

    let dataIki = new Date(data);
    dataIki = dataIki.toISOString().split("T")[0] + " 23:59:59";

    // URL-encode spaces and colons
    const encodedDataNuo = encodeURIComponent(dataNuo);
    const encodedDataIki = encodeURIComponent(dataIki);

    // Build URL
    let url = `https://liteko.teismai.lt/viesasprendimupaieska/paieska.aspx?nuo=${encodedDataNuo}&iki=${encodedDataIki}`;

    let response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }

    let text = await response.text();

    let { document } = parseHTML(text);

    let el = document.querySelector(
        "div.rdpWrap:nth-child(2) > div:nth-child(1)",
    );
    if (!el) return false;
    let rezultatuSkaiciausTekstas = el.innerText;

    let rezultatuSkaicius = parseInt(
        rezultatuSkaiciausTekstas.match(/iš (\d+)/)[1],
        10,
    );

    log(`Puslapis prižadėjo ${rezultatuSkaicius} rezultatų`);

    let bylos = rezultataiToJson(document);
    if (rezultatuSkaicius > 50) {
        let viewState = document.querySelector("#__VIEWSTATE")?.value;
        let viewStateGen = document.querySelector(
            "#__VIEWSTATEGENERATOR",
        )?.value;

        const pageButtons = [
            null,
            "01",
            "02",
            "03",
            "04",
            "05",
            "06",
            "07",
            "08",
            "09",
            "10",
            "02",
            "03",
            "04",
            "05",
            "06",
            "07",
            "08",
            "09",
            "10",
            "11",
            "02",
            "03",
            "04",
            "05",
            "06",
            "07",
            "08",
            "09",
            "10",
            "11",
            "02",
            "03",
            "04",
            "05",
            "06",
            "07",
            "08",
            "09",
            "10",
            "11",
            "02",
            "03",
            "04",
            "05",
            "06",
            "07",
            "08",
            "09",
            "10",
            "11",
            "02",
            "03",
            "04",
            "05",
            "06",
            "07",
            "08",
            "09",
            "10",
            "11",
            "02",
            "03",
            "04",
            "05",
            "06",
            "07",
            "08",
            "09",
            "10",
            "11",
            "02",
            "03",
            "04",
            "05",
            "06",
            "07",
            "08",
            "09",
            "10",
            "11",
            "02",
            "03",
            "04",
            "05",
            "06",
            "07",
            "08",
            "09",
            "10",
            "11",
            "02",
            "03",
            "04",
            "05",
            "06",
            "07",
            "08",
            "09",
            "10",
            "11",
        ];

        for (let i = 1; i <= rezultatuSkaicius / 50; i++) {
            // pad with a 0
            let pageNumber = i.toString().padStart(2, "0");

            let postBody = new URLSearchParams();

            postBody.append(
                "__EVENTTARGET",
                `ctl00$ContentPlaceHolder1$listRez$RadDataPager1$ctl00$ctl${pageButtons[i]}`,
            );

            postBody.append("__VIEWSTATE", viewState);
            postBody.append("__VIEWSTATEGENERATOR", viewStateGen);

            response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: postBody.toString(),
            });

            text = await response.text();
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            ({ document } = parseHTML(text));
            let bylosNaujos = rezultataiToJson(document);
            viewState = document.querySelector("#__VIEWSTATE")?.value;
            viewStateGen = document.querySelector(
                "#__VIEWSTATEGENERATOR",
            )?.value;
            bylos.push(...bylosNaujos);
        }
    }

    let duration = new Date() - startTime;

    log(
        `Nuskaitytos ${bylos.length} ${dataNuo.substr(0, 10)} dienos bylos per ${(duration / 1000).toFixed(3)} sekundžių`,
    );

    return bylos;
}

/**
 * Parsinami bylos rezultatai iš HTML dokumento į JSON formatą.
 * @param {Document} document - HTML dokumentas, iš kurio bus parsinami bylos rezultatai.
 * @returns {Array} - Grąžina masyvą bylų objektų JSON formatu.
 */
function rezultataiToJson(document) {
    // Find all <td> containing <b>Bylos numeris: </b>
    const tds = Array.from(document.querySelectorAll("td")).filter((td) => {
        return Array.from(td.querySelectorAll("b")).some(
            (b) => b.textContent.trim() === "Bylos numeris:",
        );
    });

    let bylos = [];
    tds.forEach((td) => {
        const bylosJson = bylosTdToJson(td);
        if (bylosJson) {
            bylos.push(bylosJson);
        }
    });

    return bylos;
}

/**
 * Normalizuoja lietuviškus simbolius į atitinkamus lotyniškus.
 * @param {string} str - Tekstas, kurį reikia normalizuoti.
 * @returns {string} - Normalizuotas tekstas.
 */
function normalize(str) {
    const map = {
        ą: "a",
        č: "c",
        ę: "e",
        ė: "e",
        į: "i",
        š: "s",
        ų: "u",
        ū: "u",
        ž: "z",
        Ą: "A",
        Č: "C",
        Ę: "E",
        Ė: "E",
        Į: "I",
        Š: "S",
        Ų: "U",
        Ū: "U",
        Ž: "Z",
    };
    return str.replace(/[^\u0000-\u007E]/g, (c) => map[c] || c);
}

/**
 * Konvertuoja tekstą į camelCase formatą.
 * @param {string} str - Tekstas, kurį reikia konvertuoti.
 * @returns {string} - Tekstas camelCase formatu.
 */
function toCamelCase(str) {
    str = normalize(str);
    return str
        .replace(/[^\w\s]/g, "") // remove punctuation
        .split(/\s+/)
        .filter(Boolean) // <- remove empty strings
        .map((word, i) =>
            i === 0
                ? word.toLowerCase()
                : word[0].toUpperCase() + word.slice(1),
        )
        .join("");
}

/**
 * Parsina bylos duomenis iš <td> elemento į JSON objektą.
 * @param {HTMLElement} td - <td> elementas, iš kurio bus parsinami bylos duomenys.
 * @returns {Object} - Grąžina bylos duomenis JSON formatu.
 */
function bylosTdToJson(td) {
    const json = {};

    // Single file link
    const a = td.querySelector("a");
    if (a) {
        json.fileText = a.textContent.trim();
        json.fileHref = a.getAttribute("href");
    }

    // Map each <b> to the next <span>, keys normalized to camelCase
    td.querySelectorAll("b").forEach((b) => {
        const key = toCamelCase(b.textContent);
        const span = b.nextElementSibling;
        if (span && span.tagName.toLowerCase() === "span") {
            json[key] = span.textContent.trim();
        }
    });

    return json;
}

var eilute = 0;
/**
 * Įterpia duomenų grupę į Postgres duomenų bazę.
 * @param {Array} rows - Duomenų grupė, kurią reikia įterpti.
 * @returns {Promise<void>}
 */
async function insertBatch(rows) {
    if (rows.length === 0) return;

    const rowPlaceholders = `($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`;
    const sql = `
         INSERT INTO bylos (
             "bylosNumeris", "bylosRusis", data, teisejai, salys,
             "citavimasKitoseBylose", teismas, "teismoRumai", "fileText", "fileHref"
         ) VALUES ${rows
             .map(
                 (_, i) =>
                     `($${i * 10 + 1},$${i * 10 + 2},$${i * 10 + 3},$${i * 10 + 4},$${i * 10 + 5},$${i * 10 + 6},$${i * 10 + 7},$${i * 10 + 8},$${i * 10 + 9},$${i * 10 + 10})`,
             )
             .join(", ")}
         ON CONFLICT ("fileHref") DO NOTHING
     `;

    const values = rows.flat();

    try {
        await postgres.query(sql, values);
        eilute += rows.length;
    } catch (err) {
        console.error(`Įterpimas nepavyko po ${eilute} eilučių:`, err.message);
    }
}

/**
 * Importuoja bylas nurodytai dienai į duomenų bazę.
 * @param {Date} date - Data, kurios bylas reikia importuoti.
 * @returns {Promise<void|boolean>} - Grąžina false, jei nėra rezultatų.
 */
async function importuotiDiena(date) {
    let dienosBylos = await nuskaitytiDiena(date);
    if (dienosBylos == false) {
        return false;
    }

    let rows = dienosBylos.map((byla) => [
        byla.bylosNumeris || null,
        byla.bylosRusis || null,
        byla.data || null,
        byla.teisejai || null,
        byla.salys || null,
        byla.citavimasKitoseBylose || null,
        byla.teismas || null,
        byla.teismoRumai || null,
        byla.fileText || null,
        byla.fileHref || null,
    ]);

    await insertBatch(rows);
}

/**
 * Nuskaito ir importuoja bylas nuo nurodytos datos iki šiandienos.
 * Jei data nenurodyta, pradėti nuo paskutinės įrašytos datos duomenų bazėje.
 * @param {Date} [startDate] - Pradžios data (Date objektas).
 * @returns {Promise<void|boolean>} - Grąžina false, kai visos dienos nuskaitytos.
 */
async function scrapeAllDays(startDate) {
    if (!startDate) {
        // Check database for the last scraped date
        const { rows } = await postgres.query(
            `SELECT MAX(data) AS "lastDate" FROM bylos`,
        );

        if (rows[0].lastDate) {
            // Resume from the next day after last scraped
            startDate = new Date(rows[0].lastDate);
            startDate.setDate(startDate.getDate() + 1);
        } else {
            // Start from the very beginning
            startDate = new Date("2005-01-06");
        }
    }

    const today = new Date();

    while (startDate <= today) {
        try {
            await importuotiDiena(new Date(startDate));
        } catch (err) {
            console.error(
                "Klaida skaitant dieną:",
                startDate.toISOString().split("T")[0],
                err.message,
            );
        }

        startDate.setDate(startDate.getDate() + 1);
    }

    log("Visos dienos nuskaitytos.");
    return false;
}

/**
 * Nuskaito ir importuoja bylas iš paskutinių nurodytų dienų.
 * @param {number} days - Kiek dienų atgal nuo paskutinės įrašytos datos duomenų bazėje reikia nuskaityti.
 * @returns {Promise<void>}
 */
export async function litekoScrapeLatestDays(days = 90) {
    // Check database for the last scraped date
    const { rows } = await postgres.query(
        `SELECT MAX(data) AS "lastDate" FROM bylos`,
    );

    let startDate;
    if (rows[0].lastDate) {
        startDate = new Date(rows[0].lastDate);
        startDate.setDate(startDate.getDate() - days);
    } else {
        // If nothing in DB, start from the very beginning
        startDate = new Date("2005-01-06");
    }

    await scrapeAllDays(startDate);
}
