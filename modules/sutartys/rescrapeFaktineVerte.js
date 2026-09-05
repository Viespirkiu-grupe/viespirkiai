/*
Pakartotinai nuskaito (rescrape) sutartis su nustatyta faktineIvykdimoVerte,
nes scrape.js iki 2026-05-28 klaidingai dalindavo reikšmę 100x per daug
(taškas buvo traktuojamas kaip tūkstančių skirtukas, o realiai jis – dešimtainis).

Vienas iškvietimas atnaujina vieną seniausią sutartį iš tų, kurios dar
neatnaujintos po klaidos pataisymo. Kartoti per loop'ą / cron, kol grąžins false.

PASTABA: seniausiosios paieška – JOIN'as per vpm lenteles be dedikuoto indekso.
Skriptas laikinas (cutoff žemiau), tad lėtesnė užklausa priimtina.
*/

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { cvpIsScrpeById } from "./atnaujintiPagalUnikalu.js";
import { pazymetiScrapeRezultata } from "./scrapeOldestContract.js";
import Timings from "../../utils/timings.js";

// Klaidos pataisymo laikas (Europe/Vilnius). Įrašai atnaujinti po šios datos
// jau turi teisingą faktineIvykdimoVerte.
const FIX_CUTOFF = "2026-05-28 00:00:00";

export async function cvpIsRescrapeFaktineVerte() {
    let timings = new Timings();
    timings.start("findOldestFaktineVerte");
    let oldestRes = await postgres.query(
        `SELECT a."unikalusId", a."atnaujinta"
           FROM "vpmSutartys"."atnaujinimai" a
           JOIN "vpmSutartys"."sutartys" s ON s."unikalusId" = a."unikalusId"
          WHERE s."faktineVerte" IS NOT NULL
            AND (a."atnaujinta" IS NULL
                 OR a."atnaujinta" < $1::timestamp)
          ORDER BY a."atnaujinta" ASC NULLS FIRST
          LIMIT 1;`,
        [FIX_CUTOFF],
    );
    timings.end("findOldestFaktineVerte");

    if (oldestRes.rows.length === 0) {
        return false;
    }

    let id = oldestRes.rows[0].unikalusId;
    log(
        `Rescrape (faktineVerte): ID ${id}, sena data: ${oldestRes.rows[0].atnaujinta}`,
    );

    let count;
    ({ timings, count } = await cvpIsScrpeById(id, { timings }));

    timings.start("updateAtnaujinta");
    await pazymetiScrapeRezultata(id, count);
    timings.end("updateAtnaujinta");
    return true;
}

// CLI – kartoja kol baigsis arba kol nepavyks
if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    let i = 0;
    while (await cvpIsRescrapeFaktineVerte()) {
        i++;
        if (i % 100 === 0) log(`Atnaujinta ${i} sutarčių`);
    }
    log(`Baigta. Iš viso atnaujinta: ${i}`);
    postgres.end();
}
