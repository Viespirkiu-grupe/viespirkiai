/*
Atnaujiną sutarties informaciją pagal unikalų ID (CLI argumentas) iš eviesiejipirkimai.lt
*/

import { importArray } from "./import.js";
import { scrapePage } from "./scrape.js";
import { postgres } from "../../postgres/postgres.js";

/**
 * Parsiunčia ir importuoja nurodytą sutartį pagal unikalų ID.
 * @param {string} unikalusID - Unikalus ID sutarties
 * @returns {Promise<number>} Importuotų įrašų skaičius
 */
async function importID(unikalusID) {
    let start = new Date();

    // Parsiunčia
    const url = `https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&Itemid=109&filter_show=1&filter_limit=10&filter_dok_id=${unikalusID}`;
    let data = await scrapePage(url);
    if (data.sutartys.length === 0) {
        console.log(`[Import] Nerasta.`);
        return 0;
    }

    // Importuoja
    await importArray(data.sutartys);

    let end = new Date();
    console.log(`[Import] Importavimas užtruko ${end - start}ms.`);

    return data.length;
}

// Jeigu pateiktas argumentas
if (process.argv.length > 2) {
    const unikalusID = process.argv[2];
    console.log(`Importuojama sutartis: ${unikalusID}`);
    importID(unikalusID)
        .then((count) => {
            // Pavyko
            console.log(`Importuotas ${count} įrašas sutarčiai: ${unikalusID}`);
            postgres.end();
        })
        .catch((err) => {
            // Klaida
            console.error(err);
            postgres.end();
        });
}
