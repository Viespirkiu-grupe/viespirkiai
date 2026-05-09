import { postgres } from '@/postgres/postgres.js';
import { searchFailai, countFailai } from '@/modules/failai/searchFailai.js';
import { OCR_STATES } from '@/modules/failai/ocr.js';

export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 250;

export function getColorScheme(cookies?: Pick<CookieJarLike, 'get'>) {
  return cookies?.get('colorScheme')?.value || 'auto';
}

export function getFont(cookies?: Pick<CookieJarLike, 'get'>) {
  return cookies?.get('font')?.value || 'ubuntu';
}

export function cleanQuery(url: URL) {
  const raw = Object.fromEntries(url.searchParams);
  const cleaned: Record<string, string> = {};
  let hasEmpty = false;
  for (const [key, value] of Object.entries(raw)) {
    if (value !== '') cleaned[key] = value;
    else hasEmpty = true;
  }
  if (hasEmpty) {
    const qs = new URLSearchParams(cleaned).toString();
    return { query: cleaned, redirectTo: url.pathname + (qs ? `?${qs}` : '') };
  }
  return { query: cleaned };
}

type CookieJarLike = {
  get(name: string): { value?: string } | undefined;
};

function formatPlural(number: number, cases: [string, string, string, string]) {
  const n = Math.abs(Number(number));
  const str = number.toString();
  const hasFraction = str.includes('.') || str.includes(',');

  let form: string;
  if (hasFraction && n !== 0) {
    form = cases[3];
  } else if (n % 10 === 1 && !(n % 100 >= 11 && n % 100 <= 19)) {
    form = cases[0];
  } else if (n % 10 >= 2 && n % 10 <= 9 && !(n % 100 >= 11 && n % 100 <= 19)) {
    form = cases[1];
  } else {
    form = cases[2];
  }

  return `${n.toLocaleString('lt-LT').replace(/\u00A0/g, ' ')} ${form}`;
}

function formatPluralK(number: number, cases: [string, string]) {
  const n = Math.abs(Number(number));
  const form = n % 10 === 1 && n % 100 !== 11 ? cases[0] : cases[1];
  return `${n.toLocaleString('lt-LT').replace(/\u00A0/g, ' ')} ${form}`;
}

export function parseLimit(query: Record<string, string>, defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT) {
  if (query.limit === 'max') return { limit: maxLimit };
  const n = parseInt(query.limit);
  if (n > maxLimit) return { error: `Limitas per didelis. Maksimalus limitas yra ${maxLimit}.` };
  if (n > 0) return { limit: n };
  return { limit: defaultLimit };
}

export function buildNumberOfResults({ rows, total, elapsed, engine = 'PostgreSQL', approximate = false }: { rows: unknown[]; total: number; elapsed: number; engine?: string; approximate?: boolean; }) {
  const trukme = (elapsed / 1000).toFixed(2);
  const source = `<span class="inline" data-duration="${trukme}">(${trukme}s, ${engine})</span>`;
  if (approximate) {
    const rounded = Math.round(total / 100) * 100 || total;
    return `Apie ${formatPluralK(rounded, ['rezultato', 'rezultatų'])} ${source}`;
  }
  if (rows.length < total) return `Rodomi ${rows.length} iš ${formatPluralK(total, ['rezultato', 'rezultatų'])} ${source}`;
  return `${formatPlural(total, ['rezultatas', 'rezultatai', 'rezultatų', 'rezultato'])} ${source}`;
}

export function buildSaltinioLink(row: any) {
  const saltinis = row.saltinis || 'sutartys';
  if (saltinis === 'sutartys') {
    if (row.dokId && row.fileId) return `https://eviesiejipirkimai.lt/download.php?dok_id=${row.dokId}&file_id=${row.fileId}`;
    if (row.saltinioId) return `https://eviesiejipirkimai.lt/${row.saltinioId}`;
  }
  if (saltinis === 'neskelbiamosDerybos' && row.saltinioId) return `https://eviesiejipirkimai.lt/${row.saltinioId}`;
  if (saltinis === 'cvpIs') {
    const parts = (row.saltinioId || '').split('/');
    if (parts.length >= 3) return `https://viesiejipirkimai.lt/epps/cft/downloadDocumentVersion.do?versionId=${parts[2]}&documentId=${parts[1]}`;
  }
  if (saltinis === 'cvpp') {
    const parts = String(row.saltinioId || '').split('/').filter(Boolean);
    if (parts.length >= 3 && parts[0]) return `https://pirkimai.eviesiejipirkimai.lt/app/rfq/rwlentrance_s.asp?PID=${encodeURIComponent(parts[0])}&B=PPO`;
    const dvid = parts.length >= 3 ? parts[1] : parts[0];
    const lid = parts.length >= 3 ? parts[2] : parts[1];
    if (!dvid || !lid) return '';
    return `https://pirkimai.eviesiejipirkimai.lt/app/docmgmt/downloadPublicDocument.asp?FMT=5&AT=3&LID=${lid}&DVID=${dvid}`;
  }
  if (saltinis === 'mvpAprasai' && row.saltinioId) return `https://mw.eviesiejipirkimai.lt/${row.saltinioId}`;
  return '';
}

export function enrichFailasRow(row: any) {
  return { ...row, pletinys: row.extension, saltinis: row.saltinis || 'sutartys', saltinioLink: buildSaltinioLink(row) };
}

export function makeExcerpt(text = '', searchTerm = '', maxChars = 250, leading = 25) {
  if (!text) return '';
  text = text.replace(/<[^>]+>/g, '');
  const isPhrase = /^".+"$/.test(searchTerm.trim());
  const inner = isPhrase ? searchTerm.trim().slice(1, -1) : '';
  const regex = isPhrase ? new RegExp(`(${inner.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi') : new RegExp(`(${searchTerm.split(/\s+/).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const match = regex.exec(text);
  if (!match) return text.slice(0, maxChars) + (text.length > maxChars ? '...' : '');
  const start = Math.max(0, match.index - Math.floor(leading));
  const end = Math.min(text.length, start + maxChars);
  return text.slice(start, end).replace(regex, '<mark>$1</mark>') + (end < text.length ? '...' : '');
}

export function processSearchResults(rows: any[], searchTerm: string) {
  return rows.map((row) => {
    try { row.tekstas = JSON.parse(row.tekstas).join(' '); } catch {}
    if (row.tekstas) {
      if (row.tekstas.startsWith('["')) row.tekstas = row.tekstas.slice(2);
      if (row.tekstas.endsWith('"]')) row.tekstas = row.tekstas.slice(0, -2);
    }
    row.metaduomenys?.signatures?.forEach((sig: any) => {
      if (sig.signerFullDistinguishedName) sig.signerFullDistinguishedName = sig.signerFullDistinguishedName.replace(/\d{4,}/g, '');
    });
    row.excerpt = makeExcerpt(row.tekstas, searchTerm);
    return row;
  });
}

export { postgres, searchFailai, countFailai, OCR_STATES };