import { searchSuggestions as tsSearchSuggestions } from "../../typesense/typesense.js";
import { searchJar } from "@/modules/juridiniai/search.js";

export interface Suggestion {
    id: string;
    pavadinimas: string;
    saltinis: string;
    count: number;
}

/** Šaltinio žymė juridinių asmenų pasiūlymams (JAR Typesense kolekcija). */
export const JURIDINIAI_SALTINIS = "juridiniai";

/**
 * Paieškos pasiūlymai (autocomplete).
 *
 * Pagrindiniai pasiūlymai ateina iš Typesense "searchSuggestion" kolekcijos.
 * Kai šaltinis neribojamas (universali paieška), PAPILDOMAI vykdoma ir juridinių
 * asmenų paieška atskiroje "viespirkiaiJAR" kolekcijoje, o rezultatai
 * sumaišomi — į patį "searchSuggestion" indeksą nieko nededama.
 *
 * @param query - Naudotojo įvestas tekstas
 * @param options - limit: kiek grąžinti; saltinis: filtruoti pagal šaltinį
 */
export async function searchSuggestions(
    query: string,
    options: { limit?: number; saltinis?: string } = {},
): Promise<Suggestion[]> {
    const { limit = 8, saltinis = "" } = options;
    if (!query.trim()) return [];

    // Juridiniai gyvena atskiroje JAR kolekcijoje, o ne bendrame
    // "searchSuggestion" indekse, todėl šį šaltinį maršrutizuojam tiesiai ten.
    if (saltinis === JURIDINIAI_SALTINIS) return searchJarSuggestions(query, limit);

    // Kiti konkretūs šaltiniai lieka bendrame pasiūlymų indekse.
    if (saltinis) return tsSearchSuggestions(query, options);

    const [base, jar] = await Promise.all([
        tsSearchSuggestions(query, options),
        searchJarSuggestions(query, limit),
    ]);

    return mergeSuggestions(base, jar, limit);
}

/** Juridinių asmenų pasiūlymai iš "viespirkiaiJAR" Typesense kolekcijos. */
async function searchJarSuggestions(
    query: string,
    limit: number,
): Promise<Suggestion[]> {
    try {
        const { results } = await searchJar({ search: query }, { page: 1, limit });
        return (results as Array<{ jarKodas?: string | number; pavadinimas?: string }>)
            .filter((r) => r.pavadinimas)
            .map((r) => ({
                id: `jar-${r.jarKodas ?? r.pavadinimas}`,
                pavadinimas: String(r.pavadinimas),
                saltinis: JURIDINIAI_SALTINIS,
                count: 0,
            }));
    } catch {
        // JAR paieška papildoma — jei kolekcija nepasiekiama, grąžinam pagrindinius.
        return [];
    }
}

/**
 * Sumaišo abu sąrašus paeiliui (po vieną iš kiekvieno), kad ir dokumentų, ir
 * juridinių asmenų pasiūlymai matytųsi, dedupliuojant pagal pavadinimą.
 */
function mergeSuggestions(
    base: Suggestion[],
    jar: Suggestion[],
    limit: number,
): Suggestion[] {
    const merged: Suggestion[] = [];
    const seen = new Set<string>();
    const maxLen = Math.max(base.length, jar.length);
    for (let i = 0; i < maxLen && merged.length < limit; i++) {
        for (const list of [base, jar]) {
            const s = list[i];
            if (!s) continue;
            const key = s.pavadinimas.trim().toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(s);
            if (merged.length >= limit) break;
        }
    }
    return merged;
}
