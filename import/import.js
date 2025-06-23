import { viespirkiai } from "../mongo/mongoDb.js";
import { addDocumentToSearch } from "../typesense/typesense.js";

export async function importArray(data) {
	let operations = [];
	let items = [];
	for (let i = 0; i < data.length; i++) {
		let item = data[i];

		// Parse numeric fields
		item.verte =
			typeof item.verte === "string"
				? parseFloat(item.verte.replace(/,/g, "."))
				: null;
		item.faktineIvykdimoVerte =
			typeof item.faktineIvykdimoVerte === "string" &&
			item.faktineIvykdimoVerte !== ""
				? parseFloat(item.faktineIvykdimoVerte.replace(/,/g, "."))
				: null;

		// Parse dates
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

		// Parse ID
		item.sutartiesUnikalusID = item.sutartiesUnikalusID
			? parseInt(item.sutartiesUnikalusID, 10)
			: null;

		// Skip if no unique ID
		if (!item.sutartiesUnikalusID) continue;

		// Prepare bulk upsert operation
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
		// Insert into mongoDB
		let startTime = Date.now();
		await viespirkiai.bulkWrite(operations);
		let endTime = Date.now();
		console.log(`MondoDB bulkWrite took ${endTime - startTime}ms`);

		// Insert into Typesense
		let startTypesenseTime = Date.now();
		for (const item of items) {
			await addDocumentToSearch(item);
		}
		let endTypesenseTime = Date.now();
		console.log(`Typesense addDocument took ${endTypesenseTime - startTypesenseTime}ms`);
		console.log(`Inserted/Updated ${operations.length} records.`);
	}
}
