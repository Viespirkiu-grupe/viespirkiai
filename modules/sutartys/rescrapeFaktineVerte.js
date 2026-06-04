/*
Pakartotinai nuskaito (rescrape) sutartis su nustatyta faktineIvykdimoVerte,
nes scrape.js iki 2026-05-28 klaidingai dalindavo reikšmę 100x per daug
(taškas buvo traktuojamas kaip tūkstančių skirtukas, o realiai jis – dešimtainis).

Vienas iškvietimas atnaujina vieną seniausią sutartį iš tų, kurios dar
neatnaujintos po klaidos pataisymo. Kartoti per loop'ą / cron, kol grąžins false.

Pagalbinis indeksas (sukurti rankiniu būdu, žr. apačioje):

  CREATE INDEX CONCURRENTLY IF NOT EXISTS
    "sutartys_faktine_verte_atnaujinta_idx"
  ON public.sutartys ("paskutiniKartaAtnaujinta" NULLS FIRST)
  WHERE "faktineIvykdimoVerte" IS NOT NULL;
*/

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { cvpIsScrpeById } from "./atnaujintiPagalUnikalu.js";
import Timings from "../../utils/timings.js";
import { typesense } from "../../typesense/typesense.js";

// Klaidos pataisymo laikas (Europe/Vilnius). Įrašai atnaujinti po šios datos
// jau turi teisingą faktineIvykdimoVerte.
const FIX_CUTOFF = "2026-05-28 00:00:00";

export async function cvpIsRescrapeFaktineVerte() {
    let timings = new Timings();
    timings.start("findOldestFaktineVerte");
    let oldestRes = await postgres.query(
        `SELECT "sutartiesUnikalusId", "paskutiniKartaAtnaujinta"
           FROM public.sutartys
          WHERE "faktineIvykdimoVerte" IS NOT NULL
            AND ("paskutiniKartaAtnaujinta" IS NULL
                 OR "paskutiniKartaAtnaujinta" < $1::timestamp)
          ORDER BY "paskutiniKartaAtnaujinta" ASC NULLS FIRST
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
    if (count == 1) {
        await postgres.query(
            `UPDATE public.sutartys
                SET "paskutiniKartaAtnaujinta" = NOW() AT TIME ZONE 'Europe/Vilnius',
                    "istrinta" = false
              WHERE "sutartiesUnikalusId" = $1;`,
            [id],
        );
    } else if (count == 0) {
        await postgres.query(
            `UPDATE public.sutartys
                SET "paskutiniKartaAtnaujinta" = NOW() AT TIME ZONE 'Europe/Vilnius',
                    "istrinta" = true
              WHERE "sutartiesUnikalusId" = $1;`,
            [id],
        );
        let doc = null;
        try {
            doc = await typesense
                .collections("sutartys")
                .documents(id)
                .retrieve();
        } catch (err) {
            if (err?.httpStatus === 404) {
                doc = null;
            } else {
                throw err;
            }
        }
        if (doc) {
            await typesense.collections("sutartys").documents(id).delete();
        }
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
