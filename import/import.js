import { viespirkiai } from "../mongo/mongoDb.js";
import { addDocumentToSearch } from "../typesense/typesense.js";

/**
 * Importuoja sutarčių duomenys į MongoDB ir Typesense.
 * @param {Array} data - Duomenų masyvas, kuriame yra sutarčių informacija.
 * @returns {Promise<void>}
 */
export async function importArray(data) {
	// Paruošiame duomenis įrašymui į MongoDB ir Typesense
	let operations = [];
	let items = [];
	for (let i = 0; i < data.length; i++) {
		let item = data[i];

		// Skaičiai
		item.verte =
			typeof item.verte === "string"
				? parseFloat(item.verte.replace(/,/g, "."))
				: null;
		item.faktineIvykdimoVerte =
			typeof item.faktineIvykdimoVerte === "string" &&
			item.faktineIvykdimoVerte !== ""
				? parseFloat(item.faktineIvykdimoVerte.replace(/,/g, "."))
				: null;

		// Datos
		const dateFields = [
			"sudarymoData",
			"galiojimoData",
			"faktineIvykdimoData",
			"paskelbimoData",
			"paskutinioAtnaujinimoData",
			"paskutinioRedagavimoData",
		];
		for (const field of dateFields) {
			if (item[field]) {
				item[field] = new Date(item[field]);
			}
		}

		// ID
		item.sutartiesUnikalusID = item.sutartiesUnikalusID
			? parseInt(item.sutartiesUnikalusID, 10)
			: null;

		// Praleidžiame be unikalaus ID (nors tokių neturėtų būti)
		if (!item.sutartiesUnikalusID) continue;

		// Įrašome operacijas
		operations.push({
			updateOne: {
				filter: { sutartiesUnikalusID: item.sutartiesUnikalusID },
				update: { $set: item },
				upsert: true,
			},
		});

		items.push(item);
	}

	if (operations.length > 0) {
		// Įterpiame į MongoDB
		let startTime = Date.now();
		await viespirkiai.bulkWrite(operations);
		console.log(`MondoDB bulkWrite užtruko ${Date.now() - startTime}ms`);

		// Įterpiame į Typesense
		let startTypesenseTime = Date.now();
		for (const item of items) {
			await addDocumentToSearch(item);
		}

		console.log(`Typesense addDocument užtruko ${Date.now() - startTypesenseTime}ms`);
		console.log(`Įterpti / atnaujinti ${operations.length} įrašai.`);
	}
}
