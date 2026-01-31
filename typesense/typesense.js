import Typesense from "typesense";
import config from "../utils/config.js";

export const client = new Typesense.Client({
    nodes: config.typesenseNodes,
    apiKey: config.typesenseApiKey,
    connectionTimeoutSeconds: 5000,
});

const COLLECTION = "sutartys";
const SCHEMA_VERSION = 8;

const schema = {
    name: COLLECTION,
    fields: [
        { name: "id", type: "string" },
        { name: "tipas", type: "string", facet: true },
        { name: "pavadinimas", type: "string" },
        { name: "kategorija", type: "string" },
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
        { name: "bvpzKodas", type: "string" },
        { name: "bvpzPavadinimas", type: "string" },
        { name: "paskelbimoData", type: "int64" },
        { name: "sutartiesNumeris", type: "string" },
        { name: "sutartiesUnikalusId", type: "int32" },
        { name: "papildomiTiekejai", type: "string[]" },
        { name: "papildomiTiekejaiKodai", type: "string[]" },
        { name: "papildomiBvpzKodai", type: "string[]" },
        { name: "papildomiBvpzPavadinimai", type: "string[]" },
        { name: "paskutiniKartaMatyta", type: "int64" },
        { name: "pirkimoNumeris", type: "string" },
    ],
    default_sorting_field: "paskutinioRedagavimoData",
    metadata: {
        version: SCHEMA_VERSION,
    },
};

let collectionInitialized = false;

/**
 * Užtikrina, kad Typesense kolekcija būtų sukurta ir atnaujinta.
 * Jei kolekcija jau egzistuoja, bet schema nesutampa, ji bus perrašyta.
 * @returns {Promise<void>}
 */
export async function ensureSearchCollection() {
    if (collectionInitialized) return;

    try {
        // Patikriname, ar kolekcija jau egzistuoja
        const existing = await client.collections(COLLECTION).retrieve();

        const existingVersion = existing.metadata?.version ?? 0;

        if (existingVersion !== SCHEMA_VERSION) {
            // Versija nesutampa
            console.log(
                `[Typesense] Existing schema version: ${existingVersion}, Expected: ${SCHEMA_VERSION}`,
            );

            console.log(
                "[Typesense] Schema version mismatch. Replacing collection...",
            );

            // Ištriname esamą kolekciją ir sukuriame naują su atnaujinta schema
            await client.collections(COLLECTION).delete();
            await client.collections().create(schema);
        }
    } catch (err) {
        // Jei kolekcija neegzistuoja, sukuriame ją
        console.log("[Typesense] Collection not found, creating...");
        await client.collections().create(schema);
    }

    collectionInitialized = true;
}

/**
 * Konvertuoja datą į Unix timestamp (sekundėmis nuo 1970-01-01).
 * @param {Date|string} date - Data, kurią reikia konvertuoti
 * @returns {number} Unix timestamp
 */
function toUnixTimestamp(date) {
    const ts = new Date(date).getTime();
    return Number.isFinite(ts) ? Math.floor(ts / 1000) : 0;
}

/**
 * Prideda dokumentą į Typesense paieškos kolekciją.
 * @param {Object} doc - Dokumentas, kurį reikia pridėti
 * @returns {Promise<void>}
 * @throws {Error} Jei nepavyksta pridėti dokumento
 */
export async function addDocumentToSearch(doc) {
    const tsDoc = {
        id: doc.sutartiesUnikalusID?.toString() || "",

        tipas: doc.tipas || "",
        pavadinimas: doc.pavadinimas || "",
        kategorija: doc.kategorija || "",

        perkanciojiOrganizacija: doc.perkanciojiOrganizacija || "",
        perkanciosiosOrganizacijosKodas:
            doc.perkanciosiosOrganizacijosKodas || "",

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
        paskutinioAtnaujinimoData: toUnixTimestamp(
            doc.paskutinioAtnaujinimoData,
        ),
        paskutinioRedagavimoData: toUnixTimestamp(doc.paskutinioRedagavimoData),
        faktineIvykdimoData: toUnixTimestamp(doc.faktineIvykdimoData),

        bvpzKodas: doc.bvpzKodas || "",
        bvpzPavadinimas: doc.bvpzPavadinimas || "",

        sutartiesNumeris: doc.sutartiesNumeris || "",
        sutartiesUnikalusId: doc.sutartiesUnikalusID.toString(),
        dokumentuKiekis: doc.dokumentuKiekis || 0,
        pirkimoNumeris: doc.pirkimoNumeris || "",
        papildomiTiekejai: doc.papildomiTiekejai || [],
        papildomiTiekejaiKodai: doc.papildomiTiekejaiKodai || [],
        papildomiBvpzKodai: doc.papildomiBvpzKodai || [],
        papildomiBvpzPavadinimai: doc.papildomiBvpzPavadinimai || [],
        paskutiniKartaMatyta: toUnixTimestamp(doc.paskutiniKartaMatyta),
        pirkimoNumeris: doc.pirkimoNumeris || "",
    };

    return client.collections(COLLECTION).documents().upsert(tsDoc);
}

/**
 * Prideda kelis dokumentus į Typesense paieškos kolekciją.
 * @param {Object[]} docs - Dokumentų masyvas
 * @returns {Promise<void>}
 * @throws {Error} Jei nepavyksta pridėti dokumentų
 */
export async function addDocumentsToSearch(docs) {
    if (!Array.isArray(docs) || docs.length === 0) return;

    const tsDocs = docs.map((doc) => ({
        id: doc.sutartiesUnikalusID?.toString() || "",

        tipas: doc.tipas || "",
        pavadinimas: doc.pavadinimas || "",
        kategorija: doc.kategorija || "",

        perkanciojiOrganizacija: doc.perkanciojiOrganizacija || "",
        perkanciosiosOrganizacijosKodas:
            doc.perkanciosiosOrganizacijosKodas || "",

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
        paskutinioAtnaujinimoData: toUnixTimestamp(
            doc.paskutinioAtnaujinimoData,
        ),
        paskutinioRedagavimoData: toUnixTimestamp(doc.paskutinioRedagavimoData),
        faktineIvykdimoData: toUnixTimestamp(doc.faktineIvykdimoData),

        bvpzKodas: doc.bvpzKodas || "",
        bvpzPavadinimas: doc.bvpzPavadinimas || "",

        sutartiesNumeris: doc.sutartiesNumeris || "",
        sutartiesUnikalusId: doc.sutartiesUnikalusID,
        dokumentuKiekis: doc.dokumentuKiekis || 0,
        pirkimoNumeris: doc.pirkimoNumeris || "",
        papildomiTiekejai: doc.papildomiTiekejai || [],
        papildomiTiekejaiKodai: doc.papildomiTiekejaiKodai || [],
        papildomiBvpzKodai: doc.papildomiBvpzKodai || [],
        papildomiBvpzPavadinimai: doc.papildomiBvpzPavadinimai || [],
        paskutiniKartaMatyta: toUnixTimestamp(doc.paskutiniKartaMatyta),
    }));

    return client
        .collections(COLLECTION)
        .documents()
        .import(tsDocs, { action: "upsert" });
}

/**
 * Ieško dokumentų pagal užklausą.
 * @param {string} query - Paieškos užklausa
 * @param {Object} options - Papildomi paieškos parametrai
 * @param {number} options.limit - Rezultatų skaičius (numatytas 50)
 * @param {number} options.page - Puslapio numeris (numatytas 1)
 * @param {string} options.sortBy - Rikiavimo kriterijus (numatytas "sudarymoData:desc")
 * @param {string} options.filterBy - Filtravimo kriterijus
 * @returns {Promise<Object>} Paieškos rezultatai ir bendras įrašų skaičius
 */
export async function searchDocuments(query, options = {}) {
    const {
        limit = 50,
        page = 1,
        sortBy = "sudarymoData:desc",
        filterBy = "",
    } = options;

    const PAGE_SIZE = 250;

    // If limit <= 250, do the normal single request
    if (limit <= PAGE_SIZE) {
        let results = await client.collections(COLLECTION).documents().search({
            q: query,
            query_by:
                "sutartiesNumeris,pavadinimas,perkanciojiOrganizacija,tiekejas,bvpzPavadinimas,papildomiTiekejai,papildomiBvpzPavadinimai",
            sort_by: sortBy,
            filter_by: filterBy,
            per_page: limit,
            page: page,
        });

        return {
            results: results.hits.map((hit) => hit.document),
            total: results.found,
        };
    }

    // Otherwise fetch page by page
    let allDocs = [];
    let total = null;

    let remaining = limit;
    let currentPage = page;

    while (remaining > 0) {
        const size = Math.min(PAGE_SIZE, remaining);

        const results = await client
            .collections(COLLECTION)
            .documents()
            .search({
                q: query,
                query_by:
                    "sutartiesNumeris,pavadinimas,perkanciojiOrganizacija,tiekejas,bvpzPavadinimas,papildomiTiekejai,papildomiBvpzPavadinimai",
                sort_by: sortBy,
                filter_by: filterBy,
                per_page: size,
                page: currentPage,
            });

        // Extract total once
        if (total === null) total = results.found;

        // Append batch
        for (const hit of results.hits) {
            allDocs.push(hit.document);
        }

        // Stop early if Typesense returned fewer results than requested
        if (results.hits.length < size) break;

        remaining -= size;
        currentPage++;
    }

    return { results: allDocs, total };
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
        { name: "adresoId", type: "int64" },
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
    if (jarCollectionInitialized) return;

    try {
        // Patikriname, ar kolekcija jau egzistuoja
        const existing = await client.collections(JAR_COLLECTION).retrieve();

        const existingVersion = existing.metadata?.version ?? 0;

        if (existingVersion !== JAR_SCHEMA_VERSION) {
            // Versija nesutampa
            console.log(
                `[Typesense] Existing schema version: ${existingVersion}, Expected: ${JAR_SCHEMA_VERSION}`,
            );

            console.log(
                "[Typesense] Schema version mismatch. Replacing collection...",
            );

            // Ištriname esamą kolekciją ir sukuriame naują su atnaujinta schema
            await client.collections(JAR_COLLECTION).delete();
            await client.collections().create(jar_schema);

            // migrateAllDocumentsToTypesenseFromCollection(viespirkiai); // FUNKCIJA NEEGZISTUOJA
        }
    } catch (err) {
        // Jei kolekcija neegzistuoja, sukuriame ją
        console.log("[Typesense] Collection not found, creating...");
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
            adresoId: doc.adresoId || 0,
        };
        documents.push(tsDoc);
    }

    return client
        .collections(JAR_COLLECTION)
        .documents()
        .import(documents, { action: "upsert" });
}

/** Ieško JAR dokumentų pagal užklausą.
 * @param {string} query - Paieškos užklausa
 * @param {Object} options - Papildomi paieškos parametrai
 * @param {number} options.limit - Rezultatų skaičius vienoje puslapyje (numatytas 50)
 * @param {number} options.page - Puslapio numeris (numatytas 1)
 * @param {string} options.sortBy - Rikiavimo kriterijus (numatytas "")
 * @param {string} options.filterBy - Filtravimo kriterijus (numatytas "")
 * @returns {Promise<Object>} Paieškos rezultatai ir bendras įrašų skaičius
 */
function levenshtein(a, b) {
    const matrix = Array.from({ length: b.length + 1 }, () =>
        Array(a.length + 1).fill(0),
    );

    for (let i = 0; i <= b.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            const cost =
                a[j - 1].toLowerCase() === b[i - 1].toLowerCase() ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1, // deletion
                matrix[i][j - 1] + 1, // insertion
                matrix[i - 1][j - 1] + cost, // substitution
            );
        }
    }
    return matrix[b.length][a.length];
}

export async function searchJarDocuments(query, options = {}) {
    const { limit = 50, page = 1, sortBy = "", filterBy = "" } = options;
    const baseQuery = toBaseCompanyName(query);

    const results = await client
        .collections(JAR_COLLECTION)
        .documents()
        .search({
            q: baseQuery,
            query_by: "pavadinimasBase,pavadinimas,adresas",
            sort_by: sortBy,
            filter_by: filterBy,
            per_page: limit,
            page: page,
        });

    let documents = results.hits.map((hit) => hit.document);

    // Only rank by Levenshtein if all results fit on one page
    if (results.found <= limit) {
        documents.sort((a, b) => {
            const nameA = a.pavadinimasBase || a.pavadinimas;
            const nameB = b.pavadinimasBase || b.pavadinimas;
            return (
                levenshtein(baseQuery, nameA) - levenshtein(baseQuery, nameB)
            );
        });
    }

    return { results: documents, total: results.found };
}

function toBaseCompanyName(name) {
    const companyTypes = [
        "UAB",
        "AB",
        "MB",
        "IĮ",
        "VšĮ",
        "ŽŪB",
        "KŪB",
        "Uždaroji akcinė bendrovė",
        "Akcinė bendrovė",
        "Mažoji bendrija",
        "Individuali įmonė",
        "Viešoji įstaiga",
        "Žemės ūkio bendrovė",
        "Kooperatinė ūkinė bendrovė",
    ];

    if (!name) return "";

    let cleaned = name
        .replace(/["“”„]/g, "")
        .replace(/,/g, "")
        .trim();

    // Pašalina visus prefiksus, nepriklausomai nuo case
    companyTypes.forEach((type) => {
        const pattern = type.replace(/\s+/g, "\\s+"); // tarpai gali būti vienas ar keli
        const regex = new RegExp(pattern, "gi");
        cleaned = cleaned.replace(regex, "");
    });

    // Normalizuoja tarpus
    return cleaned.replace(/\s+/g, " ").trim();
}
