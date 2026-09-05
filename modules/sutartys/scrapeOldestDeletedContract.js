import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { cvpIsScrpeById } from "./atnaujintiPagalUnikalu.js";
import { pazymetiScrapeRezultata } from "./scrapeOldestContract.js";
import Timings from "../../utils/timings.js";

export async function cvpIsScrapeOldestDeletedContract() {
    let timings = new Timings();
    timings.start("findOldestScrapedSutartis");
    let oldestRes = await postgres.query(`SELECT "unikalusId", "atnaujinta"
    FROM "vpmSutartys"."atnaujinimai"
    WHERE "istrinta"
      AND "atnaujinta" < (
        timezone('Europe/Vilnius', now()) - INTERVAL '3 days'
      )
    ORDER BY "atnaujinta" ASC NULLS FIRST
    LIMIT 1;`);
    timings.end("findOldestScrapedSutartis");

    if (oldestRes.rows.length === 0) {
        return false;
    }

    let id = oldestRes.rows[0].unikalusId;
    log(
        `Seniausia ištrinta sutartis pagal atnaujinimo datą: ID ${id}, data: ${oldestRes.rows[0].atnaujinta}`,
    );
    let count;
    ({ timings, count } = await cvpIsScrpeById(id, { timings }));

    timings.start("updateAtnaujinta");
    await pazymetiScrapeRezultata(id, count);
    timings.end("updateAtnaujinta");
    return true;
}

// CLI
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    while (await cvpIsScrapeOldestDeletedContract()) {}

    postgres.end();
}
