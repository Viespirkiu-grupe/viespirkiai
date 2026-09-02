import { z } from "zod";
import { searchDokumentai } from "../../../src/lib/searchDokumentai.js";

export const name = "search_dokumentai";
export const description =
    "Ieško viešųjų pirkimų ir kitų dokumentų (sutartys, CVP IS, neskelbiamos derybos, MVP tvarkos, teisės aktai, teismo nuosprendžiai) pagal pavadinimą, autorių ir turinį. " +
    "Teisės aktų ir jų projektų tekstą skaityk su get_teises_akto_tekstas: jis trumpą tekstą grąžina visą, o ilgam parenka turinį arba dalis. " +
    "Kitų rezultatų tekstą skaityk su get_dokumentas_tekstas, perduodamas dokumentoId. " +
    "Teismo sprendimą pagal LITEKO identifikatorių (uuid iš viespirkiai.org/teismoNuosprendis/<uuid> ar LITEKO adreso) imk su get_teismo_nuosprendis — jis grąžina ir bylos duomenis, dalyvius bei kategorijas. " +
    "get_failas naudok tik tada, kai turi failoId arba MD5 ir reikia failo metaduomenų.";

const TYPE_VALUES = [
    "crawledPage",
    "failas",
    "teisesAktas",
    "teisesAktoProjektas",
    "teismoNuosprendis",
];

const SOURCE_VALUES = [
    "sutartys",
    "cvpis",
    "cvpp",
    "mvpaprasai",
    "neskelbiamosderybos",
    "archive",
    "liteko",
    "eseimas",
];

const SORT_VALUES = [
    "relevance",
    "newest",
    "oldest",
    "recentlyUpdated",
    "recentlyDiscovered",
    "createdDate",
    "mostPages",
    "mostWords",
];

export const schema = {
    search: z.string().optional().describe("Pilno teksto paieška (pavadinimas, autorius, turinys)"),
    mode: z
        .enum(["words", "phrase"])
        .default("words")
        .describe("'words' (numatyta) — atskiri žodžiai; 'phrase' — tiksli frazė (žodžiai iš eilės greta)"),
    type: z
        .array(z.enum(TYPE_VALUES))
        .optional()
        .describe("Dokumento tipas. Galima nurodyti kelis."),
    extension: z
        .array(z.string())
        .optional()
        .describe("Failo plėtinys, pvz. ['pdf', 'docx', 'doc']. Galima nurodyti kelis."),
    saltinis: z
        .array(z.enum(SOURCE_VALUES))
        .optional()
        .describe("Dokumento šaltinis. Galima nurodyti kelis."),
    jarKodas: z
        .array(z.string())
        .optional()
        .describe("Dokumente paminėto juridinio asmens kodas (JAR). Galima nurodyti kelis."),
    istaiga: z
        .array(z.string())
        .optional()
        .describe("Dokumentą paskelbusios įstaigos JAR kodas. Galima nurodyti kelis."),
    sort: z
        .enum(SORT_VALUES)
        .default("relevance")
        .describe(
            "Rikiavimas: relevance (aktualumas), newest/oldest (pagal dokumento datą), recentlyUpdated, recentlyDiscovered, createdDate, mostPages, mostWords.",
        ),
    page: z.number().int().min(1).default(1).describe("Puslapio numeris (po 10 rezultatų)"),
    facetai: z
        .boolean()
        .default(false)
        .describe(
            "Ar grąžinti facetus (dažniausias filtruojamų laukų reikšmes su kiekiais) — pagelbsti susiaurinti paiešką. Numatyta false, kad atsakymas būtų trumpas.",
        ),
};

// Kiek facetų reikšmių rodyti — tiek pat, kiek UI sidebar preview'e.
const FACET_PREVIEW = 6;

// FacetOption ({ value, count, label? }) → lieknas įrašas atsakymui.
function facetRow(option) {
    return option.label
        ? { value: option.value, label: option.label, count: option.count }
        : { value: option.value, count: option.count };
}

function buildFacets(result) {
    // typeCountMap yra { value: count } — paverčiam į surikiuotą masyvą.
    const tipas = Object.entries(result.typeCountMap ?? {})
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    return {
        tipas: tipas.slice(0, FACET_PREVIEW),
        saltinis: (result.sourceOptions ?? []).slice(0, FACET_PREVIEW).map(facetRow),
        pletinys: (result.extOptions ?? []).slice(0, FACET_PREVIEW).map(facetRow),
        istaiga: (result.istaigaJarOptions ?? []).slice(0, FACET_PREVIEW).map(facetRow),
        jarKodas: (result.jarOptions ?? []).slice(0, FACET_PREVIEW).map(facetRow),
    };
}

// Snippet'as ateina su <strong> žymėmis ir HTML entity'ėmis — Claude'ui geriau
// paprastas tekstas.
function stripSnippet(html) {
    if (!html) return null;
    return html
        .replace(/<\/?strong>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
}

// Nuoroda į viespirkiai.org — failams pagal failoId, teismo sprendimams pagal LITEKO id.
function viespirkiaiUrl(h) {
    if (h.failasId) return `https://viespirkiai.org/failas/${h.failasId}`;
    if (h.type === "teismoNuosprendis" && h.saltinioId2) {
        return `https://viespirkiai.org/teismoNuosprendis/${encodeURIComponent(h.saltinioId2)}`;
    }
    return null;
}

export async function handler(params) {
    const { search, page, mode, sort, type, extension, saltinis, jarKodas, istaiga, facetai } = params;

    const result = await searchDokumentai({
        q: search,
        page,
        mode,
        sort,
        type,
        ext: extension,
        source: saltinis,
        jar: jarKodas,
        istaiga,
    });

    const dokumentai = result.hits.map((h) => ({
        id: h.id,
        dokumentoId: h.id,
        failoId: h.failasId ?? null,
        teisesAktoId: h.type === "teisesAktas" || h.type === "teisesAktoProjektas"
            ? h.saltinioId0 ?? null
            : null,
        versijosId: h.type === "teisesAktas" || h.type === "teisesAktoProjektas"
            ? h.saltinioId3 || h.saltinioId1 || "original"
            : null,
        // Teismo sprendimų LITEKO id — juo get_teismo_nuosprendis grąžina bylos duomenis.
        litekoId: h.type === "teismoNuosprendis" ? h.saltinioId2 ?? null : null,
        md5: h.md5,
        pavadinimas: h.title || h.pavadinimas,
        tipas: h.type,
        saltinis: h.source,
        autorius: h.autorius,
        pletinys: h.extension,
        puslapiai: h.pageCount,
        zodziai: h.wordCount,
        data: h.happenedAt,
        istaiga: h.istaigaPavadinimas || h.istaigaJar,
        fragmentas: stripSnippet(h.snippet),
        url: h.url || null,
        viespirkiaiUrl: viespirkiaiUrl(h),
    }));

    const payload = {
        dokumentai,
        total: result.total,
        approximate: result.approximate,
        page: result.page,
        totalPages: result.totalPages,
    };
    if (facetai) payload.facetai = buildFacets(result);

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(payload, null, 2),
            },
        ],
    };
}
