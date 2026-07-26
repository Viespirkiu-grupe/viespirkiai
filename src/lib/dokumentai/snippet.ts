// Dokumentų paieškos rezultatų ištraukos (snippet) — grynos funkcijos, iškeltos iš
// searchDokumentai.ts. Randa geriausią teksto atkarpą apie paieškos terminus ir
// paryškina radinius <strong> žymėmis. Be I/O — lengva testuoti.
import { escapeHtml } from '@design-system/lib/html.ts';
// Diakritikų pašalinimas (ė→e), išlaikant NFC. Ta pati funkcija naudojama ir
// indeksuojant (quickwit/indexQueueDrainer vartotojai), tad ji gyvena utils/.
// Re-eksportuojam, nes snippet.ts yra šio modulio viešasis API.
import { foldLithuanian } from '@/utils/text.js';

export { foldLithuanian };

/** Failų sidecar `text` saugomas kaip `JSON.stringify(pages)` — puslapių masyvo
 *  eilutė (pvz. `["1 psl.","2 psl."]`). Vartotojui to rodyti negalima, todėl jei
 *  tekstas yra JSON eilučių masyvas, sulipdom puslapius į vientisą tekstą. Kitų
 *  šaltinių (nuosprendžių) tekstas — paprasta eilutė, grąžinam kaip yra. */
export function normalizeDocText(text: string | unknown[]): string {
  // Retais atvejais sidecar tekstas gali būti jau išparsintas masyvas.
  if (Array.isArray(text)) return text.filter((p) => typeof p === 'string').join(' ');
  if (typeof text !== 'string') return '';
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('[')) return text;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((p) => typeof p === 'string').join(' ');
    }
  } catch {
    // Labai dideli tekstai saugomi nukirsti (1 MB riba + „…"), todėl JSON masyvas
    // gali būti nebaigtas ir neparsinamas. Tokiu atveju nuimam masyvo sintaksę
    // (laužtinius skliaustus ir eilučių ribas `","`) rankiniu būdu.
    return trimmed
      .replace(/^\[\s*"/, '')
      .replace(/"\s*\]\s*$/, '')
      .replace(/"\s*,\s*"/g, ' ');
  }
  return text;
}

function extractTerms(q: string): string[] {
  if (!q) return [];
  const out: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q)) !== null) {
    if (m[1]) {
      out.push(...m[1].split(/\s+/).filter(Boolean));
    } else {
      const tok = m[2];
      if (/^\w+:/.test(tok)) continue;
      if (tok) out.push(tok);
    }
  }
  return [...new Set(out)];
}

function findAll(haystack: string, needle: string): number[] {
  if (!needle) return [];
  const matches: number[] = [];
  let from = 0;
  while (from < haystack.length) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) break;
    matches.push(index);
    from = index + Math.max(1, needle.length);
  }
  return matches;
}

function bestSnippetStart(
  matches: { start: number; end: number }[],
  textLength: number,
  maxChars: number,
  leading: number,
) {
  if (!matches.length) return 0;
  let bestStart = Math.max(0, matches[0].start - leading);
  let bestCount = 0;
  for (const match of matches) {
    const candidate = Math.max(0, match.start - leading);
    const end = candidate + maxChars;
    const count = matches.filter((m) => m.start < end && m.end > candidate).length;
    if (count > bestCount) {
      bestCount = count;
      bestStart = candidate;
    }
  }
  return Math.min(bestStart, Math.max(0, textLength - maxChars));
}

function highlightRanges(text: string, ranges: { start: number; end: number }[]) {
  if (!ranges.length) return escapeHtml(text);
  const merged: { start: number; end: number }[] = [];
  for (const range of [...ranges].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  let html = '';
  let cursor = 0;
  for (const range of merged) {
    html += escapeHtml(text.slice(cursor, range.start));
    html += `<strong>${escapeHtml(text.slice(range.start, range.end))}</strong>`;
    cursor = range.end;
  }
  return html + escapeHtml(text.slice(cursor));
}

export function makeSnippet(
  text: string,
  q: string,
  mode: 'phrase' | 'words' = 'words',
  maxChars = 240,
  leading = 80,
): string | null {
  if (!text) return null;
  const normalizedText = text.replace(/\s+/g, ' ').trim();
  if (!normalizedText) return null;
  const terms = extractTerms(q);
  const foldedText = foldLithuanian(normalizedText).toLowerCase();
  const foldedTerms = terms.map((term) => foldLithuanian(term).toLowerCase()).filter(Boolean);
  const phrase = foldLithuanian(q.replace(/"/g, '').replace(/\s+/g, ' ').trim()).toLowerCase();

  let matches: { start: number; end: number }[] = [];
  if (mode === 'phrase' && phrase) {
    matches = findAll(foldedText, phrase).map((start) => ({ start, end: start + phrase.length }));
  }
  // A document may match in its title/author while its sidecar text does not
  // contain the exact phrase. In that case, still produce a useful snippet and
  // mark every query term found in the text.
  if (!matches.length) {
    matches = foldedTerms.flatMap((term) =>
      findAll(foldedText, term).map((start) => ({ start, end: start + term.length })),
    );
  }

  const start = bestSnippetStart(matches, normalizedText.length, maxChars, leading);
  const end = Math.min(normalizedText.length, start + maxChars);
  const localMatches = matches
    .filter((match) => match.start < end && match.end > start)
    .map((match) => ({
      start: Math.max(0, match.start - start),
      end: Math.min(end, match.end) - start,
    }));
  let s = highlightRanges(normalizedText.slice(start, end), localMatches);
  if (start > 0) s = '…' + s;
  if (end < normalizedText.length) s += '…';
  return s;
}
