import { z } from "zod";
import { sliceDocumentText } from "./getDokumentasTekstas.js";
import {
    legalActIdentity,
    loadLegalActDocument,
    subtreeText,
} from "./teisesAktoTurinys.js";

const DEFAULT_CHARS = 12_000;
const MAX_CHARS = 30_000;

export const name = "get_teises_akto_istrauka";
export const description =
    "Grąžina pasirinktas konkrečios teisės akto versijos dalis pagal partId, gautus iš get_teises_akto_tekstas. " +
    "Įtraukiamas pasirinktos dalies tekstas ir visi jos poskyriai. Labai ilga ištrauka dalijama naudojant sekantiPozicija.";

export const schema = {
    teisesAktoId: z
        .string()
        .min(1)
        .describe(
            "Teisės akto ID iš /teisesAktas/{teisesAktoId}; pvz. URL /teisesAktas/TAR.1776DF569DAF?v=jiiUPSqGbP reiškia teisesAktoId=TAR.1776DF569DAF, versijosId=jiiUPSqGbP",
        ),
    versijosId: z
        .string()
        .min(1)
        .default("original")
        .describe(
            "URL parametro ?v= reikšmė; pvz. ?v=jiiUPSqGbP reiškia versijosId=jiiUPSqGbP. Kai ?v nėra – original",
        ),
    dalys: z
        .array(z.string().min(1))
        .min(1)
        .max(10)
        .describe("Nuo 1 iki 10 pasirinktų turinio partId"),
    pozicija: z.number().int().min(0).default(0).describe("Pozicija sudarytoje ištraukoje"),
    kiekis: z
        .number()
        .int()
        .min(1)
        .max(MAX_CHARS)
        .default(DEFAULT_CHARS)
        .describe("Grąžinamos ištraukos simbolių limitas (1-30000)"),
};

function hasSelectedAncestor(id, selected, parentById) {
    let parent = parentById.get(id);
    while (parent) {
        if (selected.has(parent)) return true;
        parent = parentById.get(parent);
    }
    return false;
}

export async function handler({
    teisesAktoId,
    versijosId = "original",
    dalys,
    pozicija = 0,
    kiekis = DEFAULT_CHARS,
}) {
    const loaded = await loadLegalActDocument(teisesAktoId, versijosId);
    if (loaded.error) return loaded.error;
    const { dokumentas, structure, index } = loaded;
    if (!structure.length) {
        return {
            content: [{ type: "text", text: "Šis teisės aktas struktūrinio turinio neturi. Naudok get_teises_akto_tekstas." }],
            isError: true,
        };
    }

    const uniqueIds = [...new Set(dalys)];
    const missing = uniqueIds.filter((partId) => !index.byId.has(partId));
    if (missing.length) {
        return {
            content: [{ type: "text", text: `Teisės akto turinyje nerastos dalys: ${missing.join(", ")}.` }],
            isError: true,
        };
    }

    const selected = new Set(uniqueIds);
    const effective = uniqueIds.filter((partId) => !hasSelectedAncestor(partId, selected, index.parentById));
    const order = new Map(index.ordered.map((entry, position) => [entry.id, position]));
    effective.sort((a, b) => order.get(a) - order.get(b));

    const selectedParts = effective.map((partId) => {
        const entry = index.ordered.find((item) => item.id === partId);
        const text = subtreeText(entry.node);
        return {
            partId,
            pavadinimas: entry.label,
            kelias: entry.path,
            simboliai: text.length,
            text,
        };
    });
    const fullExcerpt = selectedParts
        .map((part) => `## ${part.pavadinimas}\n\n${part.text}`)
        .join("\n\n")
        .trim();

    if (pozicija > fullExcerpt.length) {
        return {
            content: [{ type: "text", text: `Pozicija ${pozicija} yra už ištraukos pabaigos (${fullExcerpt.length} simbolių).` }],
            isError: true,
        };
    }
    const sliced = sliceDocumentText(fullExcerpt, pozicija, kiekis);
    const hasMore = sliced.end < fullExcerpt.length;
    const payload = {
        ...legalActIdentity(dokumentas, teisesAktoId, versijosId),
        pasirinktosDalys: selectedParts.map(({ text: _text, ...part }) => part),
        // Paliekame tikslią dalį: apkarpius tarpus atskirų kvietimų tekstai
        // susijungtų be žodžius skiriančio tarpo.
        tekstas: sliced.text,
        meta: {
            simboliuIsViso: fullExcerpt.length,
            pozicija,
            grazintaSimboliu: sliced.text.length,
            yraDaugiau: hasMore,
            sekantiPozicija: hasMore ? sliced.end : null,
        },
    };
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
