import { cvpIsScrapePageContent } from "./scrape.js";
import { cvpIsImportArray } from "./import.js";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

async function cvpIsScrapeDay(date = new Date().toISOString().slice(0, 10)) {
    // Validate date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error("Neteisingas datos formatas, turi būti YYYY-MM-DD");
    }

    let page = 0;
    let sutarciuSkaicius = 0;
    while (true) {
        let start = new Date();
        // Sudarome puslapio URL
        let limitstart = page * 50; // Puslapiuose yra po 50 įrašų, todėl dauginame iš 50
        let kiekis = 50;

        const url = `https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&filter_limit=${kiekis}&limitstart=${limitstart}&filter_contractdate_from=${date}&filter_contractdate_to=${date}`;

        // Nuskaitome puslapį
        let { sutartys, total } = await cvpIsScrapePageContent(url);
        sutarciuSkaicius += sutartys.length;

        // Importuojame duomenis į duomenų bazę
        await cvpIsImportArray(sutartys);

        // Jei nėra duomenų, grąžina 0
        if (sutartys.length === 0 || sutarciuSkaicius >= total || !total) {
            break;
        }

        log(
            `Puslapio ${date} / ${page} importas užtruko ${((new Date() - start) / 1000).toFixed(2)}s, ${date}: ${sutarciuSkaicius}/${total || sutarciuSkaicius}`,
        );
        page++;
    }

    log(`Importuotos ${sutarciuSkaicius} sutartys.`);

    return {
        length: sutarciuSkaicius,
    };
}

export async function cvpIsScrapeLeastRecentDate() {
    let dateRes = await postgres.query(`SELECT *
    FROM public."sutartysSudarymoDatos"
    WHERE "scrapeTimestamp" IS NULL OR "scrapeTimestamp" < (
        timezone('Europe/Vilnius', now()) - INTERVAL '1 day'
    )
    ORDER BY
        "scrapeTimestamp" ASC NULLS FIRST,
        "count" ASC
    LIMIT 1;`);

    if (dateRes.rows.length === 0) {
        return false;
    }

    let date = dateRes.rows[0].sudarymoData;
    log(
        `Scrape'inama data ${date} (scrape'inta ${dateRes.rows[0].scrapeTimestamp}, count: ${dateRes.rows[0].count})`,
    );
    let result = await cvpIsScrapeDay(date);

    // Update the scrape timestamp and count
    await postgres.query(
        `UPDATE public."sutartysSudarymoDatos"
        SET "scrapeTimestamp" = NOW(), "scrapeResultCount" = $1, scrapes = scrapes + 1
        WHERE "sudarymoData" = $2;`,
        [result.length, date],
    );
    return true;
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    cvpIsScrapeLeastRecentDate()
        .then(() => {
            log("Nuskaitymas baigtas");
            postgres.end();
        })
        .catch((err) => {
            console.error("Klaida nuskaitant:", err);
            postgres.end();
        });
}
