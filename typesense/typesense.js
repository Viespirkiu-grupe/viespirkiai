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
const JAR_SCHEMA_VERSION = 10;

const jar_schema = {
    name: JAR_COLLECTION,
    fields: [
        { name: "id", type: "string" },
        { name: "jarKodas", type: "string" },
        { name: "pavadinimas", type: "string" },
        { name: "pavadinimasBase", type: "string", optional: true },
        { name: "adresas", type: "string" },
        { name: "registravimoData", type: "int64" },
        { name: "formosKodas", type: "int64" },
        { name: "formosPavadinimas", type: "string" },
        { name: "statusoKodas", type: "int64" },
        { name: "statusoPavadinimas", type: "string" },
        { name: "statusasNuo", type: "int64" },
        { name: "duomenuData", type: "int64" },
    ],
    default_sorting_field: "registravimoData",
    metadata: {
        version: JAR_SCHEMA_VERSION,
    },
};

let jarCollectionInitialized = false;

/**
 * Užtikrina, kad JAR Typesense kolekcija būtų sukurta ir atnaujinta.
 * Jei kolekcija jau egzistuoja, bet schema nesutampa, ji bus perrašyta.
 * @returns {Promise<void>}
 */
export async function ensureJarCollection() {
    if (!config.typesenseUp) return;
    if (jarCollectionInitialized) return;

    try {
        // Patikriname, ar kolekcija jau egzistuoja
        const existing = await client.collections(JAR_COLLECTION).retrieve();

        const existingVersion = existing.metadata?.version ?? 0;

        if (existingVersion !== JAR_SCHEMA_VERSION) {
            // Versija nesutampa
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
 * Prideda kelis JAR dokumentus į Typesense paieškos kolekciją.
 * @param {Object[]} givenArray - Dokumentų masyvas
 * @returns {Promise<void>}
 * @throws {Error} Jei nepavyksta pridėti dokumentų
 */
export async function addDocumentsToJarSearch(givenArray) {
    let documents = [];
    for (const doc of givenArray) {
        const tsDoc = {
            id: doc.jarKodas?.toString() || doc.pavadinimas,
            jarKodas: doc.jarKodas?.toString() || "",
            pavadinimas: doc.pavadinimas || "",
            adresas: doc.adresas || "",
            registravimoData: toUnixTimestamp(doc.registravimoData),
            formosKodas: doc.formosKodas || 0,
            formosPavadinimas: doc.formosPavadinimas || "",
            statusoKodas: doc.statusoKodas || 0,
            statusoPavadinimas: doc.statusoPavadinimas || "",
            statusasNuo: toUnixTimestamp(doc.statusasNuo),
            duomenuData: toUnixTimestamp(doc.duomenuData),
        };
        documents.push(tsDoc);
    }

    return client
        .collections(JAR_COLLECTION)
        .documents()
        .import(documents, { action: "upsert" });
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
