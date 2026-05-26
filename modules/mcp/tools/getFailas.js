import { z } from "zod";
import { findFailas, checkFailasAccessible } from "../../failai/queries.js";
import { fetchFailasMetadata } from "../../failai/aptarnavimas.js";
import { parsePgArray } from "../../../postgres/postgres.js";

const PREVIEW_PAGES = 3;
const MAX_PAGE_BATCH = 25;

function parseTekstasPages(rawTekstas) {
    if (!rawTekstas) return [];

    if (Array.isArray(rawTekstas)) {
        return rawTekstas.map((page) => String(page ?? ""));
    }

    if (typeof rawTekstas !== "string") {
        return [String(rawTekstas)];
    }

    const trimmed = rawTekstas.trim();
    if (!trimmed) return [];

    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
            return parsed.map((page) => String(page ?? ""));
        }
        if (typeof parsed === "string") {
            return [parsed];
        }
    } catch {
        // Not JSON, continue with other fallbacks.
    }

    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
            return parsePgArray(trimmed).map((page) => String(page ?? ""));
        } catch {
            // Not a parseable Postgres array.
        }
    }

    return [rawTekstas];
}

function formatPageSlice(pages, startPage, count) {
    const startIndex = Math.max(startPage - 1, 0);
    return pages
        .slice(startIndex, startIndex + count)
        .map((tekstas, index) => ({
            puslapis: startIndex + index + 1,
            tekstas,
        }));
}

export const name = "get_failas";
export const description =
    "Grąžina išsamią informaciją apie viešojo pirkimo sutarties dokumentą pagal jo ID arba md5. Apima metaduomenis, IBAN numerius, JAR kodus, el. pašto adresus, nuorodas ir parašus. Tekstas pateikiamas pagal faktinius dokumento puslapius (preview: pirmi 3) - naudokite get_failas_tekstas norėdami gauti daugiau (iki 15 vienu metu).";

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

    const metadata = await fetchFailasMetadata(failas.id, failas.tekstasHash);
    failas = { ...failas, ...metadata };

    delete failas.search_index;

    const rawTekstas = failas.tekstas;
    delete failas.tekstas;

    const pages = parseTekstasPages(rawTekstas);
    if (pages.length) {
        failas.tekstas = formatPageSlice(pages, 1, PREVIEW_PAGES);
        failas.tekstasMeta = {
            docPuslapiuIsviso: pages.length,
            rodomiPuslapiai: `1-${Math.min(PREVIEW_PAGES, pages.length)}`,
            grazintaPuslapiu: failas.tekstas.length,
            yraDaugiau: pages.length > PREVIEW_PAGES,
            maxPuslapiuVienuKartu: MAX_PAGE_BATCH,
            pastaba:
                "Daugiau puslapiu gaukite su get_failas_tekstas naudodami puslapis ir kiekis (1-25).",
        };
    }

    return {
        content: [{ type: "text", text: JSON.stringify(failas, null, 2) }],
    };
}
