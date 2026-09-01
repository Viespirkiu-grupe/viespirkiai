import { z } from "zod";
import { postgres } from "../../../postgres/postgres.js";
import { readDocumentFs } from "../../documents/documentsFs.js";
import { normalizeDocText } from "../../../src/lib/dokumentai/snippet.js";

const DEFAULT_CHARS = 12_000;
const MAX_CHARS = 30_000;

/**
 * Grąžina ne didesnę nei `count` teksto dalį. Kai įmanoma, dalį užbaigia ties
 * tarpu, kad kitas MCP kvietimas neprasidėtų žodžio viduryje.
 */
export function sliceDocumentText(text, position, count) {
    const hardEnd = Math.min(text.length, position + count);
    let end = hardEnd;

    if (hardEnd < text.length) {
        const candidate = text.slice(position, hardEnd);
        const whitespace = Math.max(
            candidate.lastIndexOf(" "),
            candidate.lastIndexOf("\n"),
            candidate.lastIndexOf("\t"),
        );
        // Labai trumpa dalis būtų mažiau naudinga nei per vidurį nukirstas žodis.
        if (whitespace >= Math.floor(count / 2)) end = position + whitespace + 1;
    }

    // Nepalikime kitos dalies prasidedančios antra UTF-16 poros puse. Tokiu
    // kraštiniu atveju leidžiame daliai būti vienu UTF-16 vienetu ilgesnei.
    if (end < text.length && end > position) {
        const last = text.charCodeAt(end - 1);
        const next = text.charCodeAt(end);
        if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end += 1;
    }

    return { text: text.slice(position, end), end };
}

export const name = "get_dokumentas_tekstas";
export const description =
    "Grąžina bet kurio search_dokumentai rezultato tekstą dalimis pagal dokumento ID. " +
    "Tinka failams, teisės aktams, teisės aktų projektams ir teismo sprendimams. " +
    "Teisės aktams pirmiausia naudok get_teises_akto_tekstas, kuris supranta jų turinį ir skiltis. " +
    "Kitai daliai perduok atsakyme pateiktą sekantiPozicija. get_failas_tekstas naudok tik tada, kai failui būtina tikra puslapių numeracija.";

export const schema = {
    id: z.number().int().positive().describe("search_dokumentai grąžintas dokumentoId"),
    pozicija: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Simbolio pozicija, nuo kurios skaityti; kitai daliai naudok sekantiPozicija"),
    kiekis: z
        .number()
        .int()
        .min(1)
        .max(MAX_CHARS)
        .default(DEFAULT_CHARS)
        .describe("Didžiausias grąžinamų simbolių kiekis (1-30000)"),
};

function error(text) {
    return { content: [{ type: "text", text }], isError: true };
}

export async function handler({ id, pozicija = 0, kiekis = DEFAULT_CHARS }) {
    const { rows } = await postgres.query(
        `SELECT d.id, d.md5, d.type, d.source, d.title AS pavadinimas, d.url,
                d."fileId" AS "failasId",
                EXISTS (
                    SELECT 1 FROM public."filesHidden" h WHERE h.id = d."fileId"
                ) AS pasleptas
         FROM documents."documentsFull" d
         WHERE d.id = $1
         LIMIT 1`,
        [id],
    );
    if (!rows.length) return error(`Dokumentas su ID ${id} nerastas.`);

    const dokumentas = rows[0];
    if (dokumentas.pasleptas) {
        return error(`Dokumentas su ID ${id} nėra viešai pasiekiamas.`);
    }
    if (!dokumentas.md5) {
        return error(`Dokumentas su ID ${id} neturi teksto saugyklos rakto (MD5).`);
    }

    const sidecar = await readDocumentFs(dokumentas.md5);
    if (!sidecar) {
        return error(`Dokumento su ID ${id} tekstas saugykloje nerastas.`);
    }

    const fullText = normalizeDocText(sidecar.text);
    if (pozicija > fullText.length) {
        return error(
            `Pozicija ${pozicija} yra už dokumento teksto pabaigos (${fullText.length} simbolių).`,
        );
    }

    const { text, end } = sliceDocumentText(fullText, pozicija, kiekis);
    const hasMore = end < fullText.length;
    const payload = {
        dokumentoId: Number(dokumentas.id),
        failoId: dokumentas.failasId ?? null,
        pavadinimas: dokumentas.pavadinimas ?? null,
        tipas: dokumentas.type ?? null,
        saltinis: dokumentas.source ?? null,
        url: dokumentas.url ?? null,
        tekstas: text,
        meta: {
            simboliuIsViso: fullText.length,
            pozicija,
            grazintaSimboliu: text.length,
            yraDaugiau: hasMore,
            sekantiPozicija: hasMore ? end : null,
            maxSimboliuVienuKartu: MAX_CHARS,
            ...(fullText.length === 0 ? { pastaba: "Dokumentas teksto neturi." } : {}),
        },
    };

    return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
}
