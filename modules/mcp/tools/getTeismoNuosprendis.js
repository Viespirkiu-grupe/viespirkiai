import { z } from "zod";
import { gautiNuosprendiPagalUuid } from "../../liteko/nuosprendisPagalUuid.js";
import { sliceDocumentText } from "./getDokumentasTekstas.js";

const DEFAULT_CHARS = 12_000;
const MAX_CHARS = 30_000;

export const name = "get_teismo_nuosprendis";
export const description =
    "Grąžina vieną teismo sprendimą (nuosprendį, nutartį) pagal LITEKO identifikatorių: bylos duomenis, " +
    "teisėjus, kategorijas, dalyvius ir tekstą dalimis. " +
    "Identifikatorių turi viespirkiai.org/teismoNuosprendis/<uuid> ir LITEKO adresai — galima paduoti ir visą tokį adresą. " +
    "Tinka ir senojo LITEKO UUID (df247241-d5d5-409c-b085-754cec5ac3f1), ir LITEKO2 id (09002711829c4977). " +
    "Kitai teksto daliai perduok atsakyme pateiktą sekantiPozicija. " +
    "Pagal bylos numerį ar turinį sprendimų ieškok su search_dokumentai (type=teismoNuosprendis).";

export const schema = {
    uuid: z
        .string()
        .min(1)
        .describe("LITEKO sprendimo identifikatorius arba jį turintis adresas"),
    pozicija: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Simbolio pozicija, nuo kurios skaityti tekstą; kitai daliai naudok sekantiPozicija"),
    kiekis: z
        .number()
        .int()
        .min(1)
        .max(MAX_CHARS)
        .default(DEFAULT_CHARS)
        .describe("Didžiausias grąžinamų teksto simbolių kiekis (1-30000)"),
};

function error(text) {
    return { content: [{ type: "text", text }], isError: true };
}

/** Iš adreso (ar gryno id) išrenka LITEKO identifikatorių. */
export function normalizuotiUuid(input) {
    const value = String(input).trim();
    if (!value.includes("/") && !value.includes("?")) return value;
    // .../teismoNuosprendis/<uuid>, .../tekstas.aspx?id=<uuid>, .../v1/decisions/<id>
    const uuid = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (uuid) return uuid[0];
    const last = value.split(/[?#]/)[0].split("/").filter(Boolean).pop();
    return last ? decodeURIComponent(last) : value;
}

function isoData(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export async function handler({ uuid, pozicija = 0, kiekis = DEFAULT_CHARS }) {
    const id = normalizuotiUuid(uuid);
    const sprendimas = await gautiNuosprendiPagalUuid(id);
    if (!sprendimas) return error(`Teismo sprendimas su LITEKO ID ${id} nerastas.`);

    const { n, saltinis, dalyviai, kategorijos, teisejai, vieta, tekstas } = sprendimas;
    const fullText = tekstas ?? "";
    if (pozicija > fullText.length) {
        return error(
            `Pozicija ${pozicija} yra už sprendimo teksto pabaigos (${fullText.length} simbolių).`,
        );
    }

    const { text, end } = sliceDocumentText(fullText, pozicija, kiekis);
    const hasMore = end < fullText.length;

    const payload = {
        litekoId: n.litekoId,
        saltinis,
        dokumentoId: sprendimas.dokumentoId,
        md5: n.md5 ?? null,
        bylosNumeris: n.bylosNumeris ?? null,
        teisminisProcesoNr: n.teisminisProcesoNr ?? null,
        teismas: n.teismas ?? null,
        teismoRumai: n.teismoRumai ?? null,
        skyrius: n.skyrius ?? null,
        instancija: n.instancija ?? null,
        bylosRusis: n.bylosRusis ?? null,
        sprendimoTipas: n.sprendimoTipas ?? null,
        busena: n.busena ?? null,
        data: isoData(n.data),
        bylaGauta: isoData(n.bylaGauta),
        bylosAprasymas: n.bylosAprasymas ?? null,
        vieta,
        teisejai,
        kategorijos: kategorijos.map((k) => k.pavadinimas),
        dalyviai: dalyviai.map((d) => ({
            pavadinimas: d.pavadinimas || null,
            kodas: d.kodas || null,
            vaidmuo: d.bylojeKaip || null,
            // 9 skaitmenų kodas — JAR kodas, tinkantis get_juridinis įrankiui.
            jarKodas: d.isJar ? d.kodas : null,
        })),
        litekoUrl: sprendimas.litekoUrl,
        viespirkiaiUrl: `https://viespirkiai.org/teismoNuosprendis/${encodeURIComponent(n.litekoId)}`,
        tekstas: text,
        meta: {
            simboliuIsViso: fullText.length,
            pozicija,
            grazintaSimboliu: text.length,
            yraDaugiau: hasMore,
            sekantiPozicija: hasMore ? end : null,
            maxSimboliuVienuKartu: MAX_CHARS,
            ...(fullText.length === 0 ? { pastaba: "Sprendimo tekstas dar nenuskaitytas." } : {}),
        },
    };

    return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}
