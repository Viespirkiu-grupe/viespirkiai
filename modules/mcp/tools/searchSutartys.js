import { z } from "zod";
import { searchSutartys } from "../../sutartys/searchSutartys.js";
import { specialJarCodes } from "../../juridiniai/specialJarCodes.js";

const MEANINGFUL_FILTERS = [
    "search",
    "perkanciosiosOrganizacijosKodas",
    "sutartiesNumeris",
    "pirkimoNumeris",
    "sutartiesUnikalusID",
];

export const name = "search_sutartys";
export const description =
    "Ieško viešųjų pirkimų sutarčių. Palaiko pilno teksto paiešką, filtravimą pagal pirkėją, tiekėją, vertę, datą, BVPZ kodus ir sutarties tipą. Sumos - eurais. " +
    "Kai filtruojama pagal tiekejoKodas arba perkanciosiosOrganizacijosKodas, atsakyme grąžinama sutarciuKiekis ir bendraVerte (bendra sutarčių suma). " +
    "SVARBU: grąžina maks. 50 eilučių puslapyje; sudėtingesnei analizei (grupavimui, procentams) naudok execute_query su v_sutartys.";

export const schema = {
    search: z.string().optional().describe("Pilno teksto paieškos užklausa"),
    perkanciosiosOrganizacijosKodas: z
        .string()
        .optional()
        .describe("Perkančiosios organizacijos kodas"),
    tiekejoKodas: z.string().optional().describe("Tiekėjo įmonės kodas"),
    tipas: z.string().optional().describe("Sutarties tipas, pvz. 'SP', 'K'"),
    sudarymoDataNuo: z
        .string()
        .optional()
        .describe("Sutarties sudarymo data nuo (YYYY-MM-DD)"),
    sudarymoDataIki: z
        .string()
        .optional()
        .describe("Sutarties sudarymo data iki (YYYY-MM-DD)"),
    verteNuo: z.number().optional().describe("Minimali sutarties vertė (EUR)"),
    verteIki: z.number().optional().describe("Maksimali sutarties vertė (EUR)"),
    bvpzPrefiksas: z
        .string()
        .optional()
        .describe("BVPZ kodo prefiksas, pvz. '45' (statybos darbai)"),
    ignoruotiSp: z.boolean().optional().describe("Nerodyti 'SP' tipo sutarčių"),
    tikSuDokumentais: z
        .boolean()
        .optional()
        .describe("Rodyti tik sutartis su pridėtais dokumentais"),
    page: z.number().int().min(1).default(1).describe("Puslapio numeris"),
    limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .default(20)
        .describe("Rezultatų skaičius puslapyje (maks. 50)"),
    sort: z
        .enum([
            "paskutinioRedagavimoData",
            "sudarymoData",
            "verte",
            "paskelbimoData",
        ])
        .optional()
        .describe(
            "Rikiavimo laukas: paskutinioRedagavimoData, sudarymoData, verte arba paskelbimoData",
        ),
};

export async function handler(params) {
    const {
        page,
        limit,
        verteNuo,
        verteIki,
        ignoruotiSp,
        tikSuDokumentais,
        ...rest
    } = params;

    const query = { ...rest };
    if (verteNuo != null) query.verteNuo = String(verteNuo);
    if (verteIki != null) query.verteIki = String(verteIki);
    if (ignoruotiSp) query.ignoruotiSp = "true";
    if (tikSuDokumentais) query.tikSuDokumentais = "true";

    if (query.tiekejoKodas != null) {
        const code = Number(query.tiekejoKodas);
        const special = specialJarCodes[code];
        if (special) {
            const hasOtherFilter = MEANINGFUL_FILTERS.some((k) => query[k] != null);
            if (!hasOtherFilter) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: `tiekejoKodas=${query.tiekejoKodas} yra bendrinis CVP IS kodas („${special.pavadinimas}"), kurį dalijasi visi tokio tipo asmenys sistemoje. Filtruoti pagal šį kodą vieną — beprasmiška: grąžintų šimtus nesusijusių sutarčių. Vietoj to naudok search="Vardas Pavardė" arba kartu pateik perkanciosiosOrganizacijosKodas.`,
                        },
                    ],
                };
            }
        }
    }

    const { results, total, sutarciuKiekis, bendraVerte } = await searchSutartys(query, {
        limit,
        page,
        engine: query.search ? "typesense" : "postgres",
    });

    return {
        content: [
            {
                type: "text",
                text: JSON.stringify(
                    { results, total, sutarciuKiekis, bendraVerte, page, limit },
                    null,
                    2,
                ),
            },
        ],
    };
}
