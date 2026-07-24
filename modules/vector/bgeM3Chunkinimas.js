import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Tokenizer } from "tokenizers";

// bge-m3 (XLM-RoBERTa / Unigram) tokenizeris teksto skaidymui į langus. Naudojam
// native Rust binding'ą (`tokenizers`) — encode/decode sukasi NAPI threadpool'e,
// tad neblokuoja JS main thread ir lygiagretūs kvietimai pasiskirsto po branduolius
// (grynas JS tokenizeris springo ties 100% vieno CPU). Reikia tik tokenizer.json.
//
// Chunkinimas: gretimos core dalys po 1024 tokenus (stride 1024), o embeddinimo
// įvestis pratęsiama +256 tokenais iš kaimynų (dėl konteksto) → langas ≤ 256 +
// 1024 + 256 = 1536 tokenų. bge-m3 pats pridės CLS/SEP embeddinimo metu.

export const CORE_TOKENS = 1024;
export const CONTEXT_TOKENS = 256;

// Labai ilgą tekstą encode'inam segmentais — native encode ties dešimtimis tūkst.
// tokenų ima elgtis superlinijiškai (176k tok ≈ 39s), o segmentuojant lieka
// tiesinis. Riba pagal simbolius (~5–7k žodžių ≈ ~10k tokenų per segmentą).
const MAX_SEG_CHARS = 30000;

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const TOKENIZER_PATH = path.join(HERE, "bgeM3Tokenizer", "BAAI", "bge-m3", "tokenizer.json");

let tokenizer = null;

/** Vienkartinis tokenizerio užkrovimas (offline, iš tokenizer.json). */
export function getBgeM3Tokenizer() {
    if (!tokenizer) tokenizer = Tokenizer.fromFile(TOKENIZER_PATH);
    return tokenizer;
}

export function hashTekstas(tekstas) {
    return createHash("md5").update(tekstas).digest("hex");
}

/** Ilgą tekstą sulaužo į ≤MAX_SEG_CHARS gabalus ties tarpais (be žodžių pjovimo). */
function segmentuoti(tekstas) {
    if (tekstas.length <= MAX_SEG_CHARS) return [tekstas];
    const segments = [];
    let i = 0;
    while (i < tekstas.length) {
        let end = Math.min(i + MAX_SEG_CHARS, tekstas.length);
        if (end < tekstas.length) {
            const ws = tekstas.lastIndexOf(" ", end);
            if (ws > i) end = ws;
        }
        segments.push(tekstas.slice(i, end));
        i = end;
    }
    return segments;
}

/** Grąžina token id masyvą (be special tokenų), ilgą tekstą encode'inant segmentais. */
async function encodeIds(tokenizer, tekstas) {
    const segments = segmentuoti(tekstas);
    if (segments.length === 1) {
        const enc = await tokenizer.encode(segments[0], null, { addSpecialTokens: false });
        return enc.getIds();
    }
    const ids = [];
    for (const seg of segments) {
        const enc = await tokenizer.encode(seg, null, { addSpecialTokens: false });
        for (const id of enc.getIds()) ids.push(id);
    }
    return ids;
}

/**
 * Suskaido failo tekstą į dedupinamus bge-m3 langus.
 * @param {import("tokenizers").Tokenizer} tokenizer
 * @param {string} tekstas
 * @returns {Promise<{ eile: number, hash: string, tekstas: string, tokenai: number }[]>}
 */
export async function chunkTekstas(tokenizer, tekstas) {
    if (tekstas == null || tekstas === "") return [];

    const ids = await encodeIds(tokenizer, tekstas);
    const n = ids.length;
    if (n === 0) return [];

    const windows = [];
    const eiles = [];
    let eile = 0;
    for (let coreStart = 0; coreStart < n; coreStart += CORE_TOKENS) {
        const coreEnd = Math.min(coreStart + CORE_TOKENS, n);
        const winStart = Math.max(0, coreStart - CONTEXT_TOKENS);
        const winEnd = Math.min(n, coreEnd + CONTEXT_TOKENS);
        windows.push(ids.slice(winStart, winEnd));
        eiles.push(eile++);
    }

    const tekstai = await tokenizer.decodeBatch(windows, false);
    return tekstai.map((langas, i) => ({
        eile: eiles[i],
        hash: hashTekstas(langas),
        tekstas: langas,
        tokenai: windows[i].length,
    }));
}
