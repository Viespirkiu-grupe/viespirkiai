/*
Atnaujiną sutarties informaciją pagal unikalų ID (argumentas) iš eviesiejipirkimai.lt
*/

import { importArray } from "../import/import.js";
import { scrapePage } from "./scrapeViespirkiai.js";

/**
 * Parsiunčia ir importuoja nurodytą sutartį pagal unikalų ID.
 * @param {string} unikalusID - Unikalus ID sutarties
 * @returns {Promise<number>} Importuotų įrašų skaičius
 */
async function importID(unikalusID) {
	let start = new Date();

	const url = `https://eviesiejipirkimai.lt/index.php?option=com_vptpublic&task=sutartys&Itemid=109&filter_show=1&filter_limit=10&filter_dok_id=${unikalusID}`;
	let data = await scrapePage(url);
	if (data.length === 0) {
		console.log(`[Import] Nerasta.`);
		return 0;
	}
	await importArray(data);

	let end = new Date();

	console.log(`[Import] Importavimas užtruko ${end - start}ms.`);

	return data.length;
}

if (process.argv.length > 2) {
	const unikalusID = process.argv[2];
	console.log(`Importuojama sutartis: ${unikalusID}`);
	importID(unikalusID)
		.then((count) => {
			console.log(`Importuotas ${count} įrašas sutarčiai: ${unikalusID}`);
		})
		.catch((err) => {
			console.error(err)
		});
}
