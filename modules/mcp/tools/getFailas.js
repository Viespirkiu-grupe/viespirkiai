import { z } from "zod";
import { findFailas, checkFailasAccessible } from "../../failai/queries.js";
import { fetchFailasMetadata } from "../../failai/aptarnavimas.js";

const PREVIEW_PAGES = 3;

export const name = "get_failas";
export const description =
    "Grąžina išsamią informaciją apie viešojo pirkimo sutarties dokumentą pagal jo ID arba md5. Apima metaduomenis, IBAN numerius, JAR kodus, el. pašto adresus, nuorodas ir parašus. Tekstas grąžinamas po 3 puslapius — naudokite get_failas_tekstas norėdami gauti daugiau.";

export const schema = {
    id: z
        .union([
            z.number().int().positive().describe("Failo numerinis ID"),
            z
                .string()
                .regex(/^[a-f0-9]{32}$/)
                .describe("Failo MD5 hash"),
        ])
        .describe("Failo ID (numerinis arba MD5)"),
};

export async function handler({ id }) {
    const result = await findFailas({ id: String(id) });
    if (!result?.rows?.length) {
        return {
            content: [{ type: "text", text: `Failas su ID ${id} nerastas.` }],
            isError: true,
        };
    }

    let failas = result.rows[0];

    const { error, message } = await checkFailasAccessible(failas);
    if (error) {
        return { content: [{ type: "text", text: message }], isError: true };
    }

    const metadata = await fetchFailasMetadata(failas.id);
    failas = { ...failas, ...metadata };

    // Tekstas — stored as JSON string array in the tekstas column
    delete failas.search_index;

    const rawTekstas = failas.tekstas;
    delete failas.tekstas;

    if (rawTekstas) {
        const pages = Array.isArray(rawTekstas)
            ? rawTekstas
            : JSON.parse(rawTekstas);

        failas.tekstas = pages.slice(0, PREVIEW_PAGES);
        failas.tekstasMeta = {
            puslapiuIsviso: pages.length,
            rodomiPuslapiai: `1–${Math.min(PREVIEW_PAGES, pages.length)}`,
            yraDaugiau: pages.length > PREVIEW_PAGES,
        };
    }

    return {
        content: [{ type: "text", text: JSON.stringify(failas, null, 2) }],
    };
}
