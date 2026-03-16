import { z } from "zod";
import { searchFailai, countFailai } from "../../failai/searchFailai.js";

export const name = "search_failai";
export const description =
    "Venk šio route jeigu eini iš kitos viešpirkių dalies, yra aiškiai duoti failų ID / md5, geriau naudok get_failas. Ieško viešųjų pirkimų sutarčių dokumentų (failų). Palaiko pilno teksto paiešką, filtravimą pagal plėtinį, telefoną, el. paštą, domeną, IBAN, JAR kodą ir kt.";

export const schema = {
    search: z
        .string()
        .optional()
        .describe(
            'Pilno teksto paieška dokumento turinyje (OCR). Frazei naudokite kabutes, pvz. "Jonas Jonaitis"',
        ),
    extension: z
        .string()
        .optional()
        .describe("Failo plėtinys, pvz. 'pdf', 'docx'"),
    saltinis: z
        .enum(["sutartys", "cvpIs", "neskelbiamosDerybos", "mvpAprasai"])
        .optional()
        .describe("Dokumento šaltinis"),
    telefonas: z.string().optional().describe("Telefono numeris dokumente"),
    email: z.string().optional().describe("El. pašto adresas dokumente"),
    domain: z.string().optional().describe("Domenas dokumente"),
    iban: z.string().optional().describe("IBAN numeris dokumente"),
    jarKodas: z
        .string()
        .optional()
        .describe("Juridinio asmens kodas dokumente"),
    puslapiaiMin: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Minimalus puslapių skaičius"),
    puslapiaiMax: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Maksimalus puslapių skaičius"),
    md5: z
        .string()
        .regex(/^[a-f0-9]{32}$/)
        .optional()
        .describe("Failo MD5 hash"),
    page: z.number().int().min(1).default(1).describe("Puslapio numeris"),
    limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Rezultatų skaičius puslapyje (maks. 50)"),
};

export async function handler(params) {
    const { page, limit, ...rest } = params;

    // Convert numbers to strings as FilterBuilder reads from Express query (strings)
    const query = {};
    for (const [k, v] of Object.entries(rest)) {
        if (v != null) query[k] = String(v);
    }

    const { results } = await searchFailai(query, { limit, page });

    // Strip heavy fields not useful for Claude
    const cleaned = results.map(({ tekstas, search_index, ...r }) => r);

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(
                    { results: cleaned, page, limit },
                    null,
                    2,
                ),
            },
        ],
    };
}
