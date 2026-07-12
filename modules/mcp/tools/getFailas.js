import { z } from "zod";
import { findFailas, checkFailasAccessible, findArchyvoVaikai } from "../../failai/queries.js";
import { fetchFailasMetadata } from "../../failai/aptarnavimas.js";
import { aprasytiNuskaityma, aprasytiParsiusima } from "../../failai/busena.js";
import { parsePgArray } from "../../../postgres/postgres.js";

const PREVIEW_PAGES = 3;
const MAX_PAGE_BATCH = 25;
const ARCHYVO_PLETINIAI = new Set(["zip", "7z", "rar", "adoc"]);

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
    "Grąžina išsamią informaciją apie viešojo pirkimo sutarties dokumentą pagal jo ID arba md5. Apima metaduomenis, IBAN numerius, JAR kodus, el. pašto adresus, nuorodas ir parašus. Tekstas pateikiamas pagal faktinius dokumento puslapius (preview: pirmi 3) - naudokite get_failas_tekstas norėdami gauti daugiau (iki 15 vienu metu). DĖMESIO dėl būsenų: `nuskaitytas` TEIGIAMA reikšmė (pvz. 12) reiškia SĖKMINGĄ nuskaitymą (skaičius = nuskaitymo versija, NE klaida); 0/null = dar nenuskaityta; NEIGIAMA = klaida. Žmogui suprantamos būsenos pateikiamos laukuose `nuskaitymoBusena` ir `parsiusimoBusena`. ARCHYVAI (zip/7z/rar): pats archyvas teksto neturi (zodziuSkaicius=0) — realus turinys yra išarchyvuotuose vaikiniuose failuose, kurie pateikiami lauke `archyvoTuriniai`. Kad perskaitytum archyvo turinį, iškviesk get_failas su tų vaikinių failų ID (jie jau nuskaityti, teksto atskirai archyvuoti NEREIKIA). Lauke `url` yra nuoroda į patį failą — pasiūlykite ją vartotojui, jei jis nori dokumentą peržiūrėti ar perskaityti pats.";

export const schema = {
    id: z
        .union([
            z.number().int().positive().describe("Failo numerinis ID"),
            z
                .string()
                .regex(/^[0-9]+$/)
                .describe("Failo numerinis ID kaip tekstas"),
            z
                .string()
                .regex(/^[a-f0-9]{32}$/)
                .describe("Failo MD5 hash"),
        ])
        .describe("Failo ID (numerinis, numerinis kaip tekstas, arba MD5)"),
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

    const metadata = await fetchFailasMetadata(failas.id, failas);
    failas = { ...failas, ...metadata };

    delete failas.search_index;

    failas.url = `https://failai.viespirkiai.org/${failas.id || failas.md5}`;
    failas.nuskaitymoBusena = aprasytiNuskaityma(failas.nuskaitytas);
    failas.parsiusimoBusena = aprasytiParsiusima(failas.parsiustas);

    const rawTekstas = failas.tekstas;
    delete failas.tekstas;

    // Archyvai (zip/7z/rar/adoc) patys teksto neturi — realus turinys yra
    // išarchyvuotuose vaikiniuose failuose. Surenkam juos, kad AI žinotų,
    // kur ieškoti, ir nesustotų ties „tuščiu" archyvu.
    if (failas.parent == null && ARCHYVO_PLETINIAI.has((failas.extension || "").toLowerCase())) {
        const vaikai = await findArchyvoVaikai(failas.id);
        if (vaikai.length) {
            failas.archyvoTuriniai = vaikai.map((v) => ({
                id: v.id,
                pavadinimas: v.pavadinimas,
                pletinys: v.extension,
                md5: v.md5,
                zodziuSkaicius: v.zodziuSkaicius,
                puslapiuSkaicius: v.puslapiuSkaicius,
                nuskaitytas: v.nuskaitytas,
            }));
            failas.archyvoTuriniaiPastaba =
                "Šis failas yra archyvas. Jo turinys — žemiau esantys vaikiniai failai (jau nuskaityti). Perskaitymui iškviesk get_failas su reikiamo vaikinio failo ID.";
        }
    }

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
