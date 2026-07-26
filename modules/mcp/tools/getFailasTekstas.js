import { z } from "zod";
import { findFailas, checkFailasAccessible, findArchyvoVaikai } from "../../failai/queries.js";
import { readFailaiFs } from "../../failai/failaiFs.js";
import { parsePgArray } from "../../../postgres/postgres.js";

const DEFAULT_PAGE_BATCH = 3;
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

// Kai failas neturi teksto, jis dažnai yra archyvas — nukreipiam AI į vaikinius
// failus, o ne paliekam aklaviete „Šis failas neturi teksto".
async function tuscioTekstoPranesimas(failas) {
    if (failas.parent == null) {
        const vaikai = await findArchyvoVaikai(failas.id);
        if (vaikai.length) {
            const sarasas = vaikai
                .map((v) => `- ID ${v.id}: ${v.pavadinimas} (${v.zodziuSkaicius ?? 0} žodž.)`)
                .join("\n");
            return `Šis failas yra archyvas ir pats teksto neturi. Turinys — vaikiniuose failuose (jau nuskaityti). Iškviesk get_failas su reikiamo ID:\n${sarasas}`;
        }
    }
    return "Šis failas neturi teksto.";
}

export const name = "get_failas_tekstas";
export const description =
    "Grąžina dokumento teksto puslapius pagal faktinius dokumento puslapių numerius. Naudoti po get_failas, kai reikia daugiau teksto. Vienu kartu galima gauti iki 15 puslapių.";

export const schema = {
    id: z.number().int().positive().describe("Failo numerinis ID"),
    puslapis: z
        .number()
        .int()
        .min(1)
        .default(1)
        .describe("Nuo kurio faktinio dokumento puslapio pradėti (1..N)"),
    kiekis: z
        .number()
        .int()
        .min(1)
        .max(MAX_PAGE_BATCH)
        .default(DEFAULT_PAGE_BATCH)
        .describe("Kiek faktinių dokumento puslapių grąžinti vienu kartu (1-25)"),
};

export async function handler({
    id,
    puslapis = 1,
    kiekis = DEFAULT_PAGE_BATCH,
}) {
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

    // Tekstas gyvena sujungtame failo turinio JSON'e (FAILAI_LOCATION).
    const rawTekstas = failas.failasHash
        ? (await readFailaiFs(failas.failasHash))?.tekstas ?? null
        : null;
    const pages = rawTekstas ? parseTekstasPages(rawTekstas) : [];
    if (!pages.length) {
        return { content: [{ type: "text", text: await tuscioTekstoPranesimas(failas) }] };
    }

    const startIndex = puslapis - 1;
    const endIndex = startIndex + kiekis;
    const puslapiai = pages
        .slice(startIndex, endIndex)
        .map((tekstas, index) => ({
            puslapis: startIndex + index + 1,
            tekstas,
        }));

    if (!puslapiai.length) {
        return {
            content: [
                {
                    type: "text",
                    text: `Puslapis ${puslapis} neegzistuoja. Dokumente yra ${pages.length} puslapiai.`,
                },
            ],
        };
    }

    const nuoPuslapio = puslapiai[0].puslapis;
    const ikiPuslapio = puslapiai[puslapiai.length - 1].puslapis;

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(
                    {
                        puslapiai,
                        meta: {
                            docPuslapiuIsviso: pages.length,
                            rodomiPuslapiai: `${nuoPuslapio}-${ikiPuslapio}`,
                            prasytasPuslapis: puslapis,
                            prasytasKiekis: kiekis,
                            grazintaPuslapiu: puslapiai.length,
                            yraDaugiau: endIndex < pages.length,
                            sekantisPuslapis:
                                endIndex < pages.length ? endIndex + 1 : null,
                            maxPuslapiuVienuKartu: MAX_PAGE_BATCH,
                        },
                    },
                    null,
                    2,
                ),
            },
        ],
    };
}
