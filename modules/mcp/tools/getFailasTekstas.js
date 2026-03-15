import { z } from "zod";
import { findFailas, checkFailasAccessible } from "../../failai/queries.js";

const PAGE_SIZE = 3;

export const name = "get_failas_tekstas";
export const description =
    "Grąžina dokumento teksto puslapius. Naudoti po get_failas kai reikia daugiau teksto.";

export const schema = {
    id: z.number().int().positive().describe("Failo numerinis ID"),
    puslapis: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Teksto puslapis (po 3 dokumento puslapius)"),
};

export async function handler({ id, puslapis = 1 }) {
    const result = await findFailas({ id: String(id) });
    if (!result?.rows?.length) {
        return {
            content: [{ type: "text", text: `Failas su ID ${id} nerastas.` }],
            isError: true,
        };
    }

    const failas = result.rows[0];

    const { error, message } = await checkFailasAccessible(failas);
    if (error) {
        return { content: [{ type: "text", text: message }], isError: true };
    }

    if (!failas.tekstas) {
        return {
            content: [{ type: "text", text: "Šis failas neturi teksto." }],
        };
    }

    const pages = Array.isArray(failas.tekstas)
        ? failas.tekstas
        : JSON.parse(failas.tekstas);

    const start = (puslapis - 1) * PAGE_SIZE;
    const slice = pages.slice(start, start + PAGE_SIZE);
    const totalOcrPages = Math.ceil(pages.length / PAGE_SIZE);

    if (!slice.length) {
        return {
            content: [
                {
                    type: "text",
                    text: `Puslapis ${puslapis} neegzistuoja. Iš viso puslapių: ${totalOcrPages}.`,
                },
            ],
        };
    }

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(
                    {
                        tekstas: slice,
                        meta: {
                            docPuslapiuIsviso: pages.length,
                            rodomiPuslapiai: `${start + 1}–${Math.min(start + PAGE_SIZE, pages.length)}`,
                            puslapis,
                            puslapiuIsviso: totalOcrPages,
                            yraDaugiau: start + PAGE_SIZE < pages.length,
                        },
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
