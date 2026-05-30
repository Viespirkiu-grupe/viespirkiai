import { searchSuggestions as tsSearchSuggestions } from "../../typesense/typesense.js";

export interface Suggestion {
    id: string;
    pavadinimas: string;
    saltinis: string;
    count: number;
}

/**
 * Paieškos pasiūlymai (autocomplete) iš Typesense "searchSuggestion" kolekcijos.
 *
 * @param query - Naudotojo įvestas tekstas
 * @param options - limit: kiek grąžinti; saltinis: filtruoti pagal šaltinį
 */
export async function searchSuggestions(
    query: string,
    options: { limit?: number; saltinis?: string } = {},
): Promise<Suggestion[]> {
    return tsSearchSuggestions(query, options);
}
