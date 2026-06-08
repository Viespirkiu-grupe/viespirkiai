/*
Backfill: įkelia jau nuskaitytus (ar dar ne) teismo nuosprendžius į dokumentų paiešką.

Tekstas DB nesaugomas, todėl „backfill" reiškia turinio nuskaitymo (detalės puslapio)
perleidimą per surastiNuosprendzioDalyvius — jis parašo sidecar + dokumentai eilutę.

  * be argumentų: nuskaito tik tuos, kurių dar nėra dokumentai lentelėje
    (atstato "turinioNuskaitymas"=0 toms eilutėms ir nudrenuoja).
  * --refresh:     iš naujo nuskaito VISUS (atstato visų "turinioNuskaitymas"=0).

Lygiagretumą valdo pats surastiNuosprendzioDalyvius (CONCURRENCY).
*/

import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";
import { surastiNuosprendzioDalyvius } from "../liteko/scrapeContent.js";

async function run() {
    const refresh = process.argv.includes("--refresh");

    if (refresh) {
        const { rowCount } = await postgres.query(
            `UPDATE "teismoNuosprendziai" SET "turinioNuskaitymas" = 0`,
        );
        log(`--refresh: atstatyta ${rowCount} eilučių pakartotiniam nuskaitymui`);
    } else {
        // Tik tie, kurių dar nėra dokumentai (source='liteko') ir kurie nebuvo
        // pažymėti klaida (-1). Klaidingus galima perleisti su --refresh.
        const { rowCount } = await postgres.query(
            `UPDATE "teismoNuosprendziai" tn
             SET "turinioNuskaitymas" = 0
             WHERE COALESCE(tn."turinioNuskaitymas", 0) NOT IN (-1)
               AND NOT EXISTS (
                 SELECT 1 FROM public.dokumentai d
                 WHERE d.source = 'liteko' AND d.md5 = tn.md5
               )`,
        );
        log(`Pažymėta ${rowCount} dar neįkeltų nuosprendžių nuskaitymui`);
    }

    const startTime = Date.now();
    let batches = 0;

    // surastiNuosprendzioDalyvius pats apdoroja paketą lygiagrečiai (CONCURRENCY),
    // todėl čia tiesiog drenuojam, kol nebelieka ką nuskaityti.
    while (await surastiNuosprendzioDalyvius()) {
        batches++;
        if (batches % 10 === 0) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
            log(`Apdorota ~${batches} paketų per ${elapsed}s`);
        }
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Baigta. Apdorota ${batches} paketų per ${elapsed}s`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    run()
        .then(async () => {
            await postgres.end();
            process.exit(0);
        })
        .catch(async (err) => {
            console.error("Klaida:", err);
            await postgres.end();
            process.exit(1);
        });
}
