import { z } from "zod";
import { sliceDocumentText } from "./getDokumentasTekstas.js";
import {
    contentRows,
    legalActIdentity,
    loadLegalActDocument,
    visibleRootNodes,
} from "./teisesAktoTurinys.js";

const FULL_TEXT_LIMIT = 30_000;
const DEFAULT_CHARS = 12_000;
const MAX_CHARS = 30_000;

export const name = "get_teises_akto_tekstas";
export const description =
    "Grąžina teisės akto konkrečios versijos tekstą pagal teisesAktoId ir versijosId iš viešo URL. " +
    "Trumpam aktui grąžina visą tekstą; ilgam aktui su struktūra – turinį, iš kurio partId perduodami get_teises_akto_istrauka; " +
    "ilgam aktui be struktūros – teksto dalį su sekantiPozicija. parentId naudok ilgo akto turinio šakai išskleisti.";

export const schema = {
    teisesAktoId: z
        .string()
        .min(1)
        .describe(
            "Teisės akto ID iš /teisesAktas/{teisesAktoId}; pvz. URL /teisesAktas/TAR.1776DF569DAF/jiiUPSqGbP reiškia teisesAktoId=TAR.1776DF569DAF, versijosId=jiiUPSqGbP",
        ),
    versijosId: z
        .string()
        .min(1)
        .default("original")
        .describe(
            "Versijos segmentas URL'e po akto ID; pvz. /teisesAktas/TAR.1776DF569DAF/jiiUPSqGbP reiškia versijosId=jiiUPSqGbP. Aktuali suvestinė redakcija – asr; kai segmento nėra – original",
        ),
    parentId: z
        .string()
        .min(1)
        .optional()
        .describe("Turinio dalies partId, kurios tiesioginius poskyrius grąžinti"),
    pozicija: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Ilgo, struktūros neturinčio akto teksto pozicija"),
    kiekis: z
        .number()
        .int()
        .min(1)
        .max(MAX_CHARS)
        .default(DEFAULT_CHARS)
        .describe("Grąžinamos teksto dalies simbolių limitas (1-30000)"),
};

function json(payload) {
    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

export async function handler({
    teisesAktoId,
    versijosId = "original",
    parentId,
    pozicija = 0,
    kiekis = DEFAULT_CHARS,
}) {
    const loaded = await loadLegalActDocument(teisesAktoId, versijosId);
    if (loaded.error) return loaded.error;
    const { dokumentas, text, structure, index } = loaded;
    const identity = legalActIdentity(dokumentas, teisesAktoId, versijosId);

    if (parentId) {
        const parent = index.byId.get(parentId);
        if (!parent) {
            return {
                content: [{ type: "text", text: `Teisės akto turinyje dalis ${parentId} nerasta.` }],
                isError: true,
            };
        }
        return json({
            ...identity,
            rezimas: "turinys",
            parentId,
            parentPavadinimas: String(parent.label ?? "").trim() || parentId,
            dalys: contentRows(parent.children),
            pastaba: parent.children?.length
                ? "Dar gilesniam lygiui kviesk šį įrankį su pasirinktos dalies partId; tekstui naudok get_teises_akto_istrauka."
                : "Ši dalis poskyrių neturi; jos tekstui naudok get_teises_akto_istrauka.",
        });
    }

    if (text.length <= FULL_TEXT_LIMIT) {
        return json({
            ...identity,
            rezimas: "visas_tekstas",
            tekstas: text,
            meta: { simboliuIsViso: text.length, yraDaugiau: false },
        });
    }

    if (structure.length) {
        const roots = visibleRootNodes(structure);
        return json({
            ...identity,
            rezimas: "turinys",
            dalys: contentRows(roots),
            meta: {
                simboliuIsViso: text.length,
                turiStruktura: true,
                visuStrukturosDaliu: index.ordered.length,
            },
            pastaba: "Pasirink dalį pagal partId. Poskyriams parodyti kviesk šį įrankį su parentId, tekstui – get_teises_akto_istrauka.",
        });
    }

    if (pozicija > text.length) {
        return {
            content: [{ type: "text", text: `Pozicija ${pozicija} yra už teisės akto teksto pabaigos (${text.length} simbolių).` }],
            isError: true,
        };
    }
    const sliced = sliceDocumentText(text, pozicija, kiekis);
    const hasMore = sliced.end < text.length;
    return json({
        ...identity,
        rezimas: "teksto_dalis",
        tekstas: sliced.text,
        meta: {
            simboliuIsViso: text.length,
            turiStruktura: false,
            pozicija,
            grazintaSimboliu: sliced.text.length,
            yraDaugiau: hasMore,
            sekantiPozicija: hasMore ? sliced.end : null,
        },
    });
}
