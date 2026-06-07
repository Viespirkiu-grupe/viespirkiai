import { z } from "zod";
import { searchJar } from "../../juridiniai/search.js";

export const name = "search_juridiniai";
export const description =
    "Ieško juridinių asmenų (įmonių) registro duomenų. Palaiko paiešką pagal pavadinimą, adresą arba vietą (koordinates).";

export const schema = {
    search: z.string().optional().describe("Įmonės pavadinimas arba jo dalis"),
    adresas: z.string().optional().describe("Tikslus registracijos adresas"),
    location: z
        .string()
        .regex(/^-?\d+\.?\d*,-?\d+\.?\d*$/)
        .optional()
        .describe("Koordinatės formatu 'lat,lon', pvz. '54.6872,25.2797'"),
    locationRadius: z
        .number()
        .min(1)
        .optional()
        .describe("Paieškos spindulys metrais (naudoti kartu su location)"),
    page: z.number().int().min(1).default(1).describe("Puslapio numeris"),
    limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Rezultatų skaičius puslapyje (maks. 50)"),
};

/**
 * @param {{
 *   search?: string,
 *   adresas?: string,
 *   location?: string,
 *   locationRadius?: number,
 *   page: number,
 *   limit: number
 * }} params
 */
export async function handler({
    search,
    adresas,
    location,
    locationRadius,
    page,
    limit,
}) {
    if (!search && !adresas && !location) {
        return {
            content: [
                {
                    type: "text",
                    text: "Būtina nurodyti bent vieną paieškos parametrą: search, adresas arba location.",
                },
            ],
            isError: true,
        };
    }

    if (location && !locationRadius) {
        return {
            content: [
                {
                    type: "text",
                    text: "Nurodžius location, būtina nurodyti ir locationRadius (metrais).",
                },
            ],
            isError: true,
        };
    }

    /** @type {Record<string, string>} */
    const query = {};
    if (search) query.search = search;
    if (adresas) query.adresas = adresas;
    if (location) query.location = location;
    if (locationRadius) query.locationRadius = String(locationRadius);

    const { results, total, searchEngine } = await searchJar(query, {
        page,
        limit,
    });

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(
                    { results, total, searchEngine, page, limit },
                    null,
                    2,
                ),
            },
        ],
    };
}
