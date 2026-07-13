import { z } from "zod";
import { searchViesiejiPirkimai } from "../../viesiejiPirkimai/searchViesiejiPirkimai.js";
import {
    STATUSAS,
    PIRKIMO_BUDAS,
} from "../../viesiejiPirkimai/viesiejiPirkimaiEnums.js";

export const name = "search_viesieji_pirkimai";
export const description =
    "Ieško viešųjų pirkimų skelbimų. Palaiko paiešką pagal pavadinimą, pirkėjo JAR kodą, statusą, pirkimo būdą, datą, vertę ir BVPŽ kodus. Veikia kartu su get_viesasis_pirkimas. Sumos - eurais.";

export const schema = {
    search: z.string().optional().describe("Pilno teksto paieška"),
    pvJarKodas: z.string().optional().describe("Pirkimo vykdytojo JAR kodas"),
    pirkimoId: z.string().optional().describe("Pirkimo ID"),
    statusas: z
        .enum(Object.keys(STATUSAS))
        .optional()
        .describe(
            `Pirkimo statusas: ${Object.entries(STATUSAS)
                .map(([k, v]) => `${k} (${v})`)
                .join(", ")}`,
        ),
    pirkimoBudas: z
        .enum(Object.keys(PIRKIMO_BUDAS))
        .optional()
        .describe(
            `Pirkimo būdas: ${Object.entries(PIRKIMO_BUDAS)
                .map(([k, v]) => `${k} (${v})`)
                .join(", ")}`,
        ),
    zingsnis: z.string().optional().describe("Pirkimo žingsnis"),
    type: z.string().optional().describe("Pirkimo tipas"),
    paskelbimoDataNuo: z
        .string()
        .optional()
        .describe("Paskelbimo data nuo (YYYY-MM-DD)"),
    paskelbimoDataIki: z
        .string()
        .optional()
        .describe("Paskelbimo data iki (YYYY-MM-DD)"),
    pasiulymuTerminasNuo: z
        .string()
        .optional()
        .describe("Pasiūlymų terminas nuo (YYYY-MM-DD)"),
    pasiulymuTerminasIki: z
        .string()
        .optional()
        .describe("Pasiūlymų terminas iki (YYYY-MM-DD)"),
    verteNuo: z.number().optional().describe("Minimali numatoma vertė (EUR)"),
    verteIki: z.number().optional().describe("Maksimali numatoma vertė (EUR)"),
    bvpzPrefiksai: z
        .string()
        .optional()
        .describe("BVPŽ kodų prefiksai, atskirti kableliais, pvz. '45,72'"),
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
    const { page, limit, verteNuo, verteIki, ...rest } = params;

    const query = {};
    for (const [k, v] of Object.entries(rest)) {
        if (v != null) query[k] = String(v);
    }
    if (verteNuo != null) query.verteNuo = String(verteNuo);
    if (verteIki != null) query.verteIki = String(verteIki);

    const { results } = await searchViesiejiPirkimai(query, { limit, page, engine: "quickwit" });

    // `turinys` jsonb išardytas į atskiras lenteles — sąrašo išvestyje jo nerodom
    // (detalės pasiekiamos per get_viesasis_pirkimas).
    for (const r of results) {
        delete r.turinys;
    }

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify({ results, page, limit }, null, 2),
            },
        ],
    };
}
