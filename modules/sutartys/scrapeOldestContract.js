import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { cvpIsScrpeById } from "./atnaujintiPagalUnikalu.js";
import { markVpmSutartisIstrinta } from "./upsertVpmSutartis.js";
import Timings from "../../utils/timings.js";

/**
 * Po sutarties scrape'o pažymi atnaujinimą ir sinchronizuoja istrinta
 * vėliavą pagal rastų sutarčių kiekį (1 = yra, 0 = ištrinta šaltinyje).
 *
 * Kai sutartis rasta (count=1), importas jau perleido ją per
 * upsertVpmSutartis (atnaujinta bump + istrinta=false + agregatai).
 * Kai nerasta (count=0), markVpmSutartisIstrinta perleidžia saugomą
 * dokumentą per tą patį upsert kelią su istrinta=true, kad archyvas ir
 * vpmSutartysSumos* agregatai liktų teisingi. Atnaujinta bump'inama
 * visada — ir jau ištrintai sutarčiai, kad ji nebūtų renkamasi iš naujo.
 */
export async function pazymetiScrapeRezultata(id, count) {
    if (count !== 0 && count !== 1) {
        throw new Error(
            `Unexpected additional contracts: ${count} for ID ${id}`,
        );
    }

    if (count === 0) {
        await markVpmSutartisIstrinta(id);
    }
    await postgres.query(
        `UPDATE public."vpmSutartysAtnaujinimai"
         SET "atnaujinta" = timezone('Europe/Vilnius', now())
         WHERE "unikalusId" = $1;`,
        [id],
    );
}

export async function cvpIsScrapeOldestContract() {
    let timings = new Timings();
    timings.start("findOldestScrapedSutartis");
    let oldestRes = await postgres.query(`SELECT "unikalusId", "atnaujinta"
      FROM public."vpmSutartysAtnaujinimai"
      WHERE "atnaujinta" IS NULL OR "atnaujinta" < (
        timezone('Europe/Vilnius', now()) - INTERVAL '2 days'
      )
      ORDER BY "atnaujinta" ASC NULLS FIRST
      LIMIT 1;`);
    timings.end("findOldestScrapedSutartis");

    if (oldestRes.rows.length === 0) {
        return false;
    }

    let id = oldestRes.rows[0].unikalusId;
    log(
        `Seniausia sutartis pagal atnaujinimo datą: ID ${id}, data: ${oldestRes.rows[0].atnaujinta}`,
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
    await cvpIsScrapeOldestContract();
    postgres.end();
}
