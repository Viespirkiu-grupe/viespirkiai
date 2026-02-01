import { postgres } from "../../postgres/postgres.js";
import { toLithuanianTime } from "../../utils/time.js";
import { typesense } from "../../typesense/typesense.js";
import { levenshtein, toAscii } from "../../utils/text.js";

/**
 * Searches for juridinis records using Typesense or PostgreSQL.
 *
 * @param {Object} query - Search query parameters.
 * @param {string} [query.search] - Full-text search string.
 * @param {string} [query.location] - Latitude and longitude as "lat,lon".
 * @param {string|number} [query.locationRadius] - Search radius in meters.
 * @param {string} [query.adresas] - Address to search for.
 * @param {Object} options - Additional options.
 * @param {number} [options.page=1] - Pagination page number.
 * @param {number} [options.limit=50] - Number of results per page.
 * @returns {Promise<{results: Array, total: number, searchEngine: string}>}
 */
export async function searchJar(query = {}, options = {}) {
    const { search, location, locationRadius, adresas } = query;
    const { page = 1, limit = 50 } = options;

    let results = [];
    let total = 0;
    let searchEngine = "Typesense";

    if (search) {
        const baseQuery = toBaseCompanyName(search);

        // Perform Typesense search
        const resultsRaw = await typesense
            .collections("viespirkiaiJAR")
            .documents()
            .search({
                q: baseQuery,
                query_by: "pavadinimasBase,pavadinimas,adresas",
                per_page: limit,
                page: page,
            });

        // Extract documents
        let documents = resultsRaw.hits.map((hit) => hit.document);

        // Only rank by Levenshtein if all results fit on one page
        if (resultsRaw.found <= limit) {
            documents.sort((a, b) => {
                const nameA = a.pavadinimasBase || a.pavadinimas;
                const nameB = b.pavadinimasBase || b.pavadinimas;
                return (
                    levenshtein(baseQuery, nameA) -
                    levenshtein(baseQuery, nameB)
                );
            });
        }

        // Format registravimoData
        results = documents.map((item) => ({
            ...item,
            registravimoData: toLithuanianTime(item.registravimoData).split(
                " ",
            )[0],
        }));

        total = resultsRaw.found;
    } else if (location && locationRadius) {
        searchEngine = "PostgreSQL";
        const [lat, lon] = location.split(",").map(Number);
        const radius = parseFloat(locationRadius);

        const { rows, rowCount } = await postgres.query(
            `
            SELECT *
            FROM public."jarCsv"
            WHERE location IS NOT NULL
              AND ST_DWithin(
                  location::geography,
                  ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
                  $3
              )
            `,
            [lon, lat, radius],
        );

        results = rows;
        total = rowCount;
    } else if (adresas) {
        searchEngine = "PostgreSQL";

        const { rows, rowCount } = await postgres.query(
            `
            SELECT *
            FROM public."jarCsv"
            WHERE "adresas" = $1
            ORDER BY "registravimoData" DESC
            `,
            [adresas],
        );

        results = rows;
        total = rowCount;
    }

    return { results, total, searchEngine };
}

/**
 * Finds a single juridinis record that is similar enough to the given string.
 *
 * Uses Typesense for search and ranks results by Levenshtein distance.
 * Returns the record only if the similarity passes a threshold.
 *
 * @param {string} queryStr - The string to search for.
 * @param {Object} options - Additional options.
 * @param {number} [options.similarityThreshold=3] - Maximum allowed Levenshtein distance.
 * @returns {Promise<Object|null>} The closest matching record, or null if none are similar enough.
 */
export async function findSingleJuridinis(queryStr, options = {}) {
    const { similarityThreshold = 1 } = options;
    if (!queryStr) return null;

    const baseQuery = toBaseCompanyName(queryStr);

    // Perform Typesense search
    const resultsRaw = await typesense
        .collections("viespirkiaiJAR")
        .documents()
        .search({
            q: baseQuery,
            query_by: "pavadinimasBase,pavadinimas,adresas",
            per_page: 10, // small page since we only need the top matches
            page: 1,
        });

    let documents = resultsRaw.hits.map((hit) => hit.document);

    // Rank by Levenshtein distance
    documents.sort((a, b) => {
        const nameA = a.pavadinimasBase || a.pavadinimas;
        const nameB = b.pavadinimasBase || b.pavadinimas;
        return levenshtein(baseQuery, nameA) - levenshtein(baseQuery, nameB);
    });

    // Take the best match
    const bestMatch = documents[0];
    if (!bestMatch) return null;

    // Check similarity threshold
    const distance = levenshtein(
        baseQuery,
        toBaseCompanyName(bestMatch.pavadinimas),
    );
    if (toBaseCompanyName(bestMatch.pavadinimas) == "") return null;
    if (distance > similarityThreshold) return null;

    // Format registravimoData
    return {
        ...bestMatch,
        registravimoData: toLithuanianTime(bestMatch.registravimoData).split(
            " ",
        )[0],
    };
}

function toBaseCompanyName(name) {
    if (!name) return "";

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

    // 1. Remove quotes, commas
    let cleaned = name
        .replace(/["“”„]/g, "")
        .replace(/,/g, "")
        .trim();

    // 2. Convert to ASCII for comparison
    let cleanedAscii = toAscii(cleaned).toLowerCase();

    // 3. Remove company types anywhere in the string
    for (const type of companyTypes) {
        const typeAscii = toAscii(type).toLowerCase();
        const pattern = "\\b" + typeAscii.replace(/\s+/g, "\\s+") + "\\b";
        const regex = new RegExp(pattern, "gi"); // g = all occurrences
        cleanedAscii = cleanedAscii.replace(regex, "");
    }

    // 4. Normalize spaces
    return cleanedAscii.replace(/\s+/g, " ").trim();
}
