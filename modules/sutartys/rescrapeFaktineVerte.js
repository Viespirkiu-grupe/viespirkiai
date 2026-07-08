/*
Pakartotinai nuskaito (rescrape) sutartis su nustatyta faktineIvykdimoVerte,
nes scrape.js iki 2026-05-28 klaidingai dalindavo reikšmę 100x per daug
(taškas buvo traktuojamas kaip tūkstančių skirtukas, o realiai jis – dešimtainis).

Vienas iškvietimas atnaujina vieną seniausią sutartį iš tų, kurios dar
neatnaujintos po klaidos pataisymo. Kartoti per loop'ą / cron, kol grąžins false.

PASTABA: "paskutiniKartaAtnaujinta" iškeltas į sutartysAtnaujinimai lentelę, o
"faktineIvykdimoVerte" lieka sutartys, todėl seniausiosios paieška dabar yra
JOIN'as (buvęs partial indeksas sutartys_faktine_verte_atnaujinta_idx panaikintas).
Skriptas laikinas (cutoff žemiau), tad lėtesnė užklausa priimtina.
*/

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { cvpIsScrpeById } from "./atnaujintiPagalUnikalu.js";
import Timings from "../../utils/timings.js";

// Klaidos pataisymo laikas (Europe/Vilnius). Įrašai atnaujinti po šios datos
// jau turi teisingą faktineIvykdimoVerte.
const FIX_CUTOFF = "2026-05-28 00:00:00";

export async function cvpIsRescrapeFaktineVerte() {
    let timings = new Timings();
    timings.start("findOldestFaktineVerte");
    let oldestRes = await postgres.query(
        `SELECT a."sutartiesUnikalusId", a."paskutiniKartaAtnaujinta"
           FROM public."sutartysAtnaujinimai" a
           JOIN public."sutartys" s ON s."sutartiesUnikalusId" = a."sutartiesUnikalusId"
          WHERE s."faktineIvykdimoVerte" IS NOT NULL
            AND (a."paskutiniKartaAtnaujinta" IS NULL
                 OR a."paskutiniKartaAtnaujinta" < $1::timestamp)
          ORDER BY a."paskutiniKartaAtnaujinta" ASC NULLS FIRST
          LIMIT 1;`,
        [FIX_CUTOFF],
    );
    timings.end("findOldestFaktineVerte");

    if (oldestRes.rows.length === 0) {
        return false;
    }

    let id = oldestRes.rows[0].sutartiesUnikalusId;
    log(
        `Rescrape (faktineIvykdimoVerte): ID ${id}, sena data: ${oldestRes.rows[0].paskutiniKartaAtnaujinta}`,
    );

    let count;
    ({ timings, count } = await cvpIsScrpeById(id, { timings }));

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
