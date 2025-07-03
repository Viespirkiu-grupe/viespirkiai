import Typesense from "typesense";
import { viespirkiai } from "../mongo/mongoDb.js";
import config from "../utils/config.js";

const client = new Typesense.Client({
	nodes: config.typesenseNodes,
	apiKey: config.typesenseApiKey,
	connectionTimeoutSeconds: 5,
});

const COLLECTION = config.typesenseCollection;

const SCHEMA_VERSION = 5;

const schema = {
	name: COLLECTION,
	fields: [
		{ name: "id", type: "string" },
		{ name: "tipas", type: "string", facet: true },
		{ name: "pavadinimas", type: "string" },
		{ name: "kategorija", type: "string", facet: true },
		{ name: "perkanciojiOrganizacija", type: "string" },
		{ name: "perkanciosiosOrganizacijosKodas", type: "string" },
		{ name: "tiekejas", type: "string" },
		{ name: "tiekejoKodas", type: "string" },
		{ name: "verte", type: "float", facet: true },
		{ name: "faktineIvykdimoVerte", type: "float", facet: true },
		{ name: "faktineIvykdimoData", type: "int64" },
		{ name: "dokumentuKiekis", type: "int32", facet: true },
		{ name: "paskutinioAtnaujinimoData", type: "int64" },
		{ name: "paskutinioRedagavimoData", type: "int64" },
		{ name: "sudarymoData", type: "int64" },
		{ name: "galiojimoData", type: "int64" },
		{ name: "bvpzKodas", type: "string", facet: true },
		{ name: "bvpzPavadinimas", type: "string" },
		{ name: "paskelbimoData", type: "int64" },
		{ name: "sutartiesNumeris", type: "string" },
		{ name: "sutartiesUnikalusID", type: "int32" },
	],
	default_sorting_field: "paskutinioRedagavimoData",
	metadata: {
		version: SCHEMA_VERSION,
	},
};

let collectionInitialized = false;

export async function ensureSearchCollection() {
	if (collectionInitialized) return;

	try {
		const existing = await client.collections(COLLECTION).retrieve();

		const existingVersion = existing.metadata?.version ?? 0;

		if (existingVersion !== SCHEMA_VERSION) {
			console.log(
				`[Typesense] Existing schema version: ${existingVersion}, Expected: ${SCHEMA_VERSION}`
			);

			console.log(
				"[Typesense] Schema version mismatch. Replacing collection..."
			);
			await client.collections(COLLECTION).delete();
			await client.collections().create(schema);

            migrateAllDocumentsToTypesenseFromCollection(viespirkiai);

		}
	} catch (err) {
		console.log("[Typesense] Collection not found, creating...");
		await client.collections().create(schema);
	}

	collectionInitialized = true;
}

function toUnixTimestamp(date) {
	const ts = new Date(date).getTime();
	return Number.isFinite(ts) ? Math.floor(ts / 1000) : 0;
}

export async function addDocumentToSearch(doc) {
	const tsDoc = {
		id: doc.sutartiesUnikalusID?.toString() || "",

		tipas: doc.tipas || "",
		pavadinimas: doc.pavadinimas || "",
		kategorija: doc.kategorija || "",

		perkanciojiOrganizacija: doc.perkanciojiOrganizacija || "",
		perkanciosiosOrganizacijosKodas: doc.perkanciosiosOrganizacijosKodas || "",

		tiekejas: doc.tiekejas || "",
		tiekejoKodas: doc.tiekejoKodas || "",

		verte: typeof doc.verte === "number" ? doc.verte : 0,
		faktineIvykdimoVerte:
			typeof doc.faktineIvykdimoVerte === "number"
				? doc.faktineIvykdimoVerte
				: 0,

		sudarymoData: toUnixTimestamp(doc.sudarymoData),
		galiojimoData: toUnixTimestamp(doc.galiojimoData),
		paskelbimoData: toUnixTimestamp(doc.paskelbimoData),
		paskutinioAtnaujinimoData: toUnixTimestamp(doc.paskutinioAtnaujinimoData),
		paskutinioRedagavimoData: toUnixTimestamp(doc.paskutinioRedagavimoData),
		faktineIvykdimoData: toUnixTimestamp(doc.faktineIvykdimoData),

		bvpzKodas: doc.bvpzKodas || "",
		bvpzPavadinimas: doc.bvpzPavadinimas || "",

		sutartiesNumeris: doc.sutartiesNumeris || "",
		sutartiesUnikalusID:
			typeof doc.sutartiesUnikalusID === "number" ? doc.sutartiesUnikalusID : 0,

		dokumentuKiekis: doc.dokumentuKiekis || 0,
	};

	return client.collections(COLLECTION).documents().upsert(tsDoc);
}

export async function searchDocuments(query, options = {}) {
	const {
		limit = 50,
		page = 1,
		sortBy = "sudarymoData:desc",
		filterBy = "",
	} = options;

	let results = await client.collections(COLLECTION).documents().search({
		q: query,
		query_by: "pavadinimas,perkanciojiOrganizacija,tiekejas,bvpzPavadinimas",
		sort_by: sortBy,
		filter_by: filterBy,
		per_page: limit,
		page: page,
	});

	let documents = results.hits.map((hit) => hit.document);

	return { results: documents, total: results.found };
}