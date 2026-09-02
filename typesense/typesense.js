import Typesense from "typesense";
import config from "../utils/config.js";
import { log } from "../utils/log.js";

export const client = new Typesense.Client({
    nodes: config.typesenseNodes,
    apiKey: config.typesenseApiKey,
    connectionTimeoutSeconds: 5000,
});

export const typesense = client;

/**
 * Konvertuoja datą į Unix timestamp (sekundėmis nuo 1970-01-01).
 * @param {Date|string} date - Data, kurią reikia konvertuoti
 * @returns {number} Unix timestamp
 */
function toUnixTimestamp(date) {
    const ts = new Date(date).getTime();
    return Number.isFinite(ts) ? Math.floor(ts / 1000) : 0;
}

///////////////////////////

const JAR_COLLECTION = "viespirkiaiJAR";
const JAR_SCHEMA_VERSION = 12;

// Šaltinis — kanoninė juridiniai."juridiniai" lentelė (žr.
// modules/juridiniai/typesenseProcessIndexQueue.js). Laikomi tik tie laukai,
// kuriuos realiai skaito paieška ar jos vartotojai: formos/statuso kodai,
// `statusasNuo` ir `duomenuData` buvo nurašyti v12, nes jų niekas neužklausė.
const jar_schema = {
    name: JAR_COLLECTION,
    fields: [
        { name: "id", type: "string" },
        { name: "jarKodas", type: "string" },
        { name: "pavadinimas", type: "string" },
        { name: "pavadinimasBase", type: "string", optional: true },
        { name: "adresas", type: "string", optional: true },
        { name: "registravimoData", type: "int64" },
        { name: "isregistruotas", type: "bool", facet: true },
        { name: "formosPavadinimas", type: "string", optional: true },
        { name: "statusoPavadinimas", type: "string", optional: true },
    ],
    default_sorting_field: "registravimoData",
    metadata: {
        version: JAR_SCHEMA_VERSION,
    },
};

let jarCollectionInitialized = false;

function jarSchemaMatches(existing) {
    // `id` yra rezervuotas Typesense dokumento laukas ir retrieve() jo
    // negrąžina kolekcijos `fields` masyve.
    const expected = new Map(
        jar_schema.fields
            .filter((field) => field.name !== "id")
            .map((field) => [field.name, field]),
    );
    const actual = new Map((existing.fields ?? []).map((field) => [field.name, field]));
    if (actual.size !== expected.size) return false;
    for (const [name, field] of expected) {
        const current = actual.get(name);
        if (!current) return false;
        if (current.type !== field.type) return false;
        if (Boolean(current.optional) !== Boolean(field.optional)) return false;
    }
    return existing.default_sorting_field === jar_schema.default_sorting_field;
}

/**
 * Užtikrina, kad JAR Typesense kolekcija būtų sukurta ir atnaujinta.
 * Jei kolekcija jau egzistuoja, bet schema nesutampa, ji bus perrašyta.
 * @returns {Promise<void>}
 */
export async function ensureJarCollection(options = {}) {
    const { ignoreTypesenseUp = false } = options;
    if (!config.typesenseUp && !ignoreTypesenseUp) return;
    if (jarCollectionInitialized) return;

    try {
        // Patikriname, ar kolekcija jau egzistuoja
        const existing = await client.collections(JAR_COLLECTION).retrieve();

        const existingVersion = existing.metadata?.version ?? 0;

        if (existingVersion !== JAR_SCHEMA_VERSION || !jarSchemaMatches(existing)) {
            // Versija arba realūs laukai nesutampa. Laukų palyginimas svarbus,
            // nes kolekcijoje gali būti likusi tos pačios versijos sena schema.
            log(
                `Existing schema version: ${existingVersion}, Expected: ${JAR_SCHEMA_VERSION}`,
            );

            log("Schema version mismatch. Replacing collection...");

            // Ištriname esamą kolekciją ir sukuriame naują su atnaujinta schema
            await client.collections(JAR_COLLECTION).delete();
            await client.collections().create(jar_schema);

            // migrateAllDocumentsToTypesenseFromCollection(viespirkiai); // FUNKCIJA NEEGZISTUOJA
        }
    } catch (err) {
        // Jei kolekcija neegzistuoja, sukuriame ją
        log("Collection not found, creating...");
        await client.collections().create(jar_schema);
        // migrateAllDocumentsToTypesenseFromCollection(viespirkiai); // FUNKCIJA NEEGZISTUOJA
    }

    jarCollectionInitialized = true;
}

/**
 * Įterpia (upsert) JAR dokumentus į Typesense paieškos kolekciją.
 * @param {Object[]} rows - juridiniai."juridiniai" eilutės su pavadinimasBase
 * @returns {Promise<void>}
 * @throws {Error} Jei nepavyksta pridėti dokumentų
 */
export async function addDocumentsToJarSearch(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;

    const documents = rows.map((row) => ({
        id: String(row.jarKodas),
        jarKodas: String(row.jarKodas),
        pavadinimas: row.pavadinimas || "",
        pavadinimasBase: row.pavadinimasBase || "",
        adresas: row.adresas || "",
        registravimoData: toUnixTimestamp(row.registravimoData),
        isregistruotas: Boolean(row.isregistruotas),
        formosPavadinimas: row.formosPavadinimas || "",
        statusoPavadinimas: row.statusoPavadinimas || "",
    }));

    return client
        .collections(JAR_COLLECTION)
        .documents()
        .import(documents, { action: "upsert" });
}

/**
 * Ištrina JAR dokumentus iš Typesense kolekcijos.
 * @param {(string|number)[]} jarKodai - Trinamų įrašų JAR kodai
 * @returns {Promise<void>}
 */
export async function deleteJarFromSearch(jarKodai) {
    if (!Array.isArray(jarKodai) || jarKodai.length === 0) return;

    return client
        .collections(JAR_COLLECTION)
        .documents()
        .delete({ filter_by: `id:[${jarKodai.map(String).join(",")}]` });
}

///////////////////////////

const SUGGESTION_COLLECTION = "searchSuggestion";
const SUGGESTION_SCHEMA_VERSION = 1;

const suggestion_schema = {
    name: SUGGESTION_COLLECTION,
    fields: [
        { name: "id", type: "string" },
        { name: "pavadinimas", type: "string" },
        { name: "saltinis", type: "string", facet: true },
        { name: "count", type: "int32" },
    ],
    // Typesense pagal nutylėjimą (be sort_by) rikiuoja default_sorting_field
    // mažėjančia tvarka, todėl pasiūlymai bus atiduodami pagal "count" desc.
    default_sorting_field: "count",
    metadata: {
        version: SUGGESTION_SCHEMA_VERSION,
    },
};

let suggestionCollectionInitialized = false;

/**
 * Užtikrina, kad paieškos pasiūlymų (autocomplete) Typesense kolekcija būtų
 * sukurta ir atnaujinta. Jei kolekcija jau egzistuoja, bet schema nesutampa,
 * ji bus perrašyta.
 * @param {{ ignoreTypesenseUp?: boolean }} options - Papildomos opcijos
 * @returns {Promise<void>}
 */
export async function ensureSuggestionCollection(options = {}) {
    const { ignoreTypesenseUp = false } = options;
    if (!config.typesenseUp && !ignoreTypesenseUp) return;
    if (suggestionCollectionInitialized) return;

    try {
        const existing = await client
            .collections(SUGGESTION_COLLECTION)
            .retrieve();

        const existingVersion = existing.metadata?.version ?? 0;

        if (existingVersion !== SUGGESTION_SCHEMA_VERSION) {
            log(
                `Existing schema version: ${existingVersion}, Expected: ${SUGGESTION_SCHEMA_VERSION}`,
            );
            log("Schema version mismatch. Replacing collection...");

            await client.collections(SUGGESTION_COLLECTION).delete();
            await client.collections().create(suggestion_schema);
        }
    } catch (err) {
        log("Collection not found, creating...");
        await client.collections().create(suggestion_schema);
    }

    suggestionCollectionInitialized = true;
}

/**
 * Įterpia (upsert) paieškos pasiūlymus į Typesense kolekciją "searchSuggestion".
 * @param {Object[]} rows - "searchSuggestion" eilutės (id, pavadinimas, saltinis, count)
 * @returns {Promise<void>}
 */
export async function addSuggestionsToSearch(rows) {
    if (!Array.isArray(rows) || rows.length === 0) return;

    const docs = rows.map((row) => ({
        id: row.id.toString(),
        pavadinimas: row.pavadinimas || "",
        saltinis: row.saltinis || "",
        count: typeof row.count === "number" ? row.count : 0,
    }));

    return client
        .collections(SUGGESTION_COLLECTION)
        .documents()
        .import(docs, { action: "upsert" });
}

/**
 * Ištrina paieškos pasiūlymus iš Typesense kolekcijos "searchSuggestion".
 * @param {(string|number)[]} ids - "searchSuggestion" id reikšmės
 * @returns {Promise<void>}
 */
export async function deleteSuggestionsFromSearch(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return;

    return client
        .collections(SUGGESTION_COLLECTION)
        .documents()
        .delete({ filter_by: `id:[${ids.map((id) => id.toString()).join(",")}]` });
}

/**
 * Ieško paieškos pasiūlymų (autocomplete) kolekcijoje "searchSuggestion".
 * Rezultatai rikiuojami pirma pagal atitikimo kokybę, paskui pagal populiarumą
 * (count mažėjimo tvarka).
 * @param {string} query - Naudotojo įvestas tekstas
 * @param {{ limit?: number, saltinis?: string }} options - limit: kiek grąžinti;
 *   saltinis: filtruoti pagal konkretų šaltinį (pvz. "sutartysPavadinimai")
 * @returns {Promise<Array<{id: string, pavadinimas: string, saltinis: string, count: number}>>}
 */
export async function searchSuggestions(query, options = {}) {
    const { limit = 8, saltinis = "" } = options;
    if (!query || !query.trim()) return [];

    const search = await client
        .collections(SUGGESTION_COLLECTION)
        .documents()
        .search({
            q: query,
            query_by: "pavadinimas",
            // _text_match -> kiek gerai atitinka, count -> populiarumas
            sort_by: "_text_match:desc,count:desc",
            per_page: limit,
            ...(saltinis ? { filter_by: `saltinis:=${saltinis}` } : {}),
        });

    return (search.hits || []).map((h) => h.document);
}
