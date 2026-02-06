/*
Atnaujiną sutarties informaciją pagal unikalų ID (CLI argumentas) iš eviesiejipirkimai.lt
*/

import { cvpIsImportArray } from "./import.js";
import { cvpIsScrapePageContent } from "./scrape.js";
import { postgres } from "../../postgres/postgres.js";
import Timings from "../../utils/timings.js";

/**
 * Parsiunčia ir importuoja nurodytą sutartį pagal unikalų ID.
 * @param {string} unikalusId - Unikalus ID sutarties
 * @returns {Promise<number>} Importuotų įrašų skaičius
 */
export async function cvpIsScrpeById(unikalusId, options = {}) {
    let timings = options.timings || new Timings();

    const url = `https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&Itemid=109&filter_show=1&filter_limit=10&filter_dok_id=${unikalusId}`;
    let sutartys;
    ({ sutartys, timings } = await cvpIsScrapePageContent(url, { timings }));
    if (sutartys.length === 0) {
        console.log(`[Import] Nerasta.`);
        return { count: 0, timings };
    }

    // Importuoja
    ({ timings } = await cvpIsImportArray(sutartys, { timings }));

    return { count: sutartys.length, timings };
}

// Jeigu pateiktas argumentas
if (process.argv.length > 2) {
    const unikalusId = process.argv[2];
    console.log(`Importuojama sutartis: ${unikalusId}`);
    cvpIsScrpeById(unikalusId)
        .then((count) => {
            // Pavyko
            console.log(`Importuotas ${count} įrašas sutarčiai: ${unikalusId}`);
            postgres.end();
        })
        .catch((err) => {
            // Klaida
            console.error(err);
            postgres.end();
        });
}
