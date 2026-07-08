import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { cvpIsScrpeById } from "./atnaujintiPagalUnikalu.js";
import Timings from "../../utils/timings.js";

export async function cvpIsScrapeOldestContract() {
    let timings = new Timings();
    timings.start("findOldestScrapedSutartis");
    let oldestRes = await postgres.query(`SELECT "sutartiesUnikalusId", "paskutiniKartaAtnaujinta"
      FROM public."sutartysAtnaujinimai"
      WHERE "paskutiniKartaAtnaujinta" IS NULL OR "paskutiniKartaAtnaujinta" < (
        timezone('Europe/Vilnius', now()) - INTERVAL '1 day'
      )
      ORDER BY "paskutiniKartaAtnaujinta" ASC NULLS FIRST
      LIMIT 1;`);
    timings.end("findOldestScrapedSutartis");

    if (oldestRes.rows.length === 0) {
        return false;
    }

    let id = oldestRes.rows[0].sutartiesUnikalusId;
    log(
        `Seniausia sutartis pagal atnaujinimo datą: ID ${id}, data: ${oldestRes.rows[0].paskutiniKartaAtnaujinta}`,
    );
    let count;
    ({ timings, count } = await cvpIsScrpeById(id, { timings }));

    // Update the "paskutiniKartaAtnaujinta" field to the current timestamp.
    // Timestamp keliauja į plonąją sutartysAtnaujinimai lentelę; istrinta
    // rašoma į sutartys tik kai reikšmė keičiasi, kad nebloatintų eilutės.
    timings.start("updatePaskutiniKartaAtnaujinta");
    await postgres.query(
        `UPDATE public."sutartysAtnaujinimai"
         SET "paskutiniKartaAtnaujinta" = NOW() AT TIME ZONE 'Europe/Vilnius'
         WHERE "sutartiesUnikalusId" = $1;`,
        [id],
    );
    if (count == 1) {
        await postgres.query(
            `UPDATE public.sutartys
             SET "istrinta" = false
             WHERE "sutartiesUnikalusId" = $1
               AND "istrinta" IS TRUE;`,
            [id],
        );
    } else if (count == 0) {
        await postgres.query(
            `UPDATE public.sutartys
             SET "istrinta" = true
             WHERE "sutartiesUnikalusId" = $1
               AND "istrinta" IS DISTINCT FROM true;`,
            [id],
        );
    } else {
        throw new Error(
            `Unexpected additional contracts: ${count} for ID ${id}`,
        );
    }

    timings.end("updatePaskutiniKartaAtnaujinta");
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
