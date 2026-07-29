// Naudotojo įvesto teksto pavertimas SAUGIA Quickwit užklausos dalimi.
//
// Anksčiau paieškos tekstas būdavo kišamas į `laukas:(<tekstas>)` beveik
// neapdorotas, tad bet kuris Quickwit užklausų kalbos simbolis (`test:`,
// `a{b`, `(`, `^`, kabantis `AND`, `IN`) sugriaudavo parserį — Quickwit
// grąžindavo „failed to parse query", o puslapis – 500 (issue #76).
//
// Todėl tekstą čia patys sudalinam į žodžius ir kiekvieną paduodam kabutėse:
// kabutėse Quickwit ieško leksemų, o ne sintaksės, tad specialieji simboliai
// tampa paprastu tekstu (juos vis tiek nukerpa tokenizatorius). Paliekam tik
// vieną naudotojui matomą sintaksę — prefiksą `žod*` (`"žod"*`).

// Kabutėse belieka ekranuoti pačią kabutę ir atgalinį brūkšnį; kitų simbolių
// ekranuoti NEGALIMA – `\t`, `\n` ir pan. Quickwit suprastų kaip escape sekas.
const escapeQuoted = (token) => token.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

// Žodžiai be nė vienos raidės/skaitmens (pvz. vien `:` ar `-`) nieko nefiltruoja
// – tik pridėtų leksemos neturinčią sąlygą, kuri nieko neatitiktų.
const hasWordChar = (token) => /[\p{L}\p{N}]/u.test(token);

/**
 * Naudotojo paieškos tekstas → Quickwit terminų sąrašas (numatytai AND, kaip ir
 * anksčiau, kai tekstas eidavo tiesiai į parserį).
 *
 * @param {string} text - jau sulietuvintas (foldLithuanian) paieškos tekstas
 * @param {{ phrase?: boolean }} [opts] - `phrase` – visas tekstas kaip viena frazė
 * @returns {string} užklausos dalis be lauko prefikso arba „" (jei nėra ko ieškoti)
 */
export function qwUserText(text, { phrase = false } = {}) {
    const raw = String(text ?? "").trim();
    if (!raw || raw === "*") return "";

    if (phrase) return hasWordChar(raw) ? `"${escapeQuoted(raw)}"` : "";

    return raw
        .split(/\s+/)
        .filter(hasWordChar)
        .map((token) => {
            // Prefiksinė paieška: `brok*` → `"brok"*` (keli `*` gale – tas pats).
            const body = token.replace(/\*+$/, "");
            return body === token ? `"${escapeQuoted(body)}"` : `"${escapeQuoted(body)}"*`;
        })
        .join(" ");
}
