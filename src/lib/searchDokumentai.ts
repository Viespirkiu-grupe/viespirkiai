import { postgres } from '@/postgres/postgres.js';
import { search } from '@/quickwit/quickwit.js';
import { readDokumentasFs } from '@/modules/dokumentai/dokumentaiFs.js';
import rawConfig from '@/utils/config.js';

const LENTELE = 'dokumentai';
const QW_URL: string = (rawConfig as any).quickwitUrl ?? 'http://localhost:7280';

// Quickwit's text fast field (used for term aggregations) lowercases values via
// its default normalizer, but the searchable field is `raw` (case-sensitive).
// So facets come back lowercased (`cvpis`) while a filter must query the true
// casing (`cvpIs`) or it matches nothing. Map known source values back to their
// canonical form for both the facet value and the query. (Proper fix would be a
// `raw` normalizer on the fast field, which needs a re-index.)
const SOURCE_CANONICAL: Record<string, string> = {
  cvpis: 'cvpIs',
  mvpaprasai: 'mvpAprasai',
  neskelbiamosderybos: 'neskelbiamosDerybos',
};
const canonSource = (v: string) => SOURCE_CANONICAL[v.toLowerCase()] ?? v;

export interface DokumentaiQuery {
  q?: string;
  /** comma-separated values (multi-select) */
  type?: string[];
  host?: string[];
  jar?: string[];
  ext?: string[];
  md5?: string;
  language?: string;
}

export interface FacetOption {
  value: string;
  count: number | null;
}

export const DOKUMENTAI_SORT_OPTIONS = [
  { value: 'relevance', label: 'Aktualumas', sortBy: '_score' },
  { value: 'newest', label: 'Naujausi dokumentai', sortBy: 'happenedAt' },
  { value: 'oldest', label: 'Seniausi dokumentai', sortBy: '-happenedAt' },
  { value: 'recentlyUpdated', label: 'Neseniai atnaujinti', sortBy: 'updatedAt' },
  { value: 'recentlyDiscovered', label: 'Neseniai aptikti', sortBy: 'discoveredAt' },
  { value: 'createdDate', label: 'Sukūrimo data', sortBy: 'createdAt' },
  { value: 'mostPages', label: 'Daugiausia puslapių', sortBy: 'pageCount' },
  { value: 'mostWords', label: 'Daugiausia žodžių', sortBy: 'wordCount' },
] as const;

export type DokumentaiSort = typeof DOKUMENTAI_SORT_OPTIONS[number]['value'];

/** One phase of the search, for the hover timing-waterfall. `start`/`duration`
 *  are milliseconds relative to the start of the request. */
export interface Timing {
  label: string;
  phase: 'search' | 'filter' | 'pg' | 'count';
  start: number;
  duration: number;
}

export interface DokumentasHit {
  id: number;
  md5: string | null;
  type: string | null;
  url: string | null;
  host: string | null;
  domain: string | null;
  source: string | null;
  pavadinimas: string | null;
  autorius: string | null;
  extension: string | null;
  language: string | null;
  pageCount: number | null;
  wordCount: number | null;
  characterCount: number | null;
  savivaldybe: string | null;
  apskritis: string | null;
  istaigaJar: string | null;
  happenedAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  discoveredAt: Date | null;
  failasId: number | null;
  title: string | null;
  snippet: string | null;
}

export interface DokumentaiSearchResult {
  q: string;
  hits: DokumentasHit[];
  total: number;
  approximate: boolean;
  elapsed: string;
  engine: string;
  timings: Timing[];
  page: number;
  totalPages: number;
  pageNums: number[];
  sort: DokumentaiSort;
  typeFilter: string[];
  hostFilter: string[];
  jarFilter: string[];
  extFilter: string[];
  authorFilter: string[];
  creatorFilter: string[];
  producerFilter: string[];
  langFilter: string[];
  savFilter: string[];
  apskritisFilter: string[];
  sourceFilter: string[];
  bbox: Bbox | null;
  typeCountMap: Record<string, number>;
  hostOptions: FacetOption[];
  extOptions: FacetOption[];
  authorOptions: FacetOption[];
  creatorOptions: FacetOption[];
  producerOptions: FacetOption[];
  langOptions: FacetOption[];
  savOptions: FacetOption[];
  apskritisOptions: FacetOption[];
  sourceOptions: FacetOption[];
}

// ── Quickwit helpers ─────────────────────────────────────────────────────────

function foldLithuanian(str: string) {
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
}

async function qwAggregate(field: string, query: string, size: number): Promise<FacetOption[]> {
  try {
    const res = await fetch(`${QW_URL}/api/v1/${LENTELE}_*/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        max_hits: 0,
        aggs: { values: { terms: { field, size } } },
        format: 'json',
      }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    return (data?.aggregations?.values?.buckets ?? []).map((b: any) => ({
      value: String(b.key),
      count: Number(b.doc_count),
    }));
  } catch {
    return [];
  }
}

// ── Query parsing ────────────────────────────────────────────────────────────

const PAGE_SIZE = 10;
const PAGINATION_WINDOW = 8;
const DOKUMENTAI_SORT_MAP = new Map<string, string>(
  DOKUMENTAI_SORT_OPTIONS.map((option) => [option.value, option.sortBy]),
);

function resolveSort(raw: string | undefined): DokumentaiSort {
  return DOKUMENTAI_SORT_MAP.has(raw ?? '') ? raw as DokumentaiSort : 'relevance';
}

function splitMulti(raw: string | string[] | undefined): string[] {
  if (raw == null) return [];
  const joined = Array.isArray(raw) ? raw.join(',') : raw;
  return joined.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Pull `type:`, `host:`, `jar:`, `ext:` tokens out of the free-text query and
 *  return them as filter additions plus the remainder. Mirrors langelis. */
export function extractInlineTokens(q: string) {
  let textQuery = q;
  const types: string[] = [];
  const hosts: string[] = [];
  const jars: string[] = [];
  const exts: string[] = [];

  textQuery = textQuery.replace(/\b(?:type|tipas):(\S+)/gi, (_, v) => { types.push(v); return ''; });
  textQuery = textQuery.replace(/\b(?:host|site|puslapis):(\S+)/gi, (_, v) => { hosts.push(v); return ''; });
  textQuery = textQuery.replace(/\b(?:jar|juridiniai|jarkodas):(\S+)/gi, (_, v) => { jars.push(v); return ''; });
  textQuery = textQuery.replace(/\b(?:extension|plėtinys|pletinys|ext):\.?(\S+)/gi, (_, v) => {
    exts.push(v.toLowerCase());
    return '';
  });

  return { textQuery: textQuery.trim(), types, hosts, jars, exts };
}

/** Geografinis stačiakampis (sritis), filtruojamas per Quickwit lat/lon range. */
export interface Bbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

function buildPartsExcluding(opts: {
  textQuery: string;
  types: string[];
  hosts: string[];
  jars: string[];
  exts: string[];
  authors: string[];
  creators: string[];
  producers: string[];
  langs: string[];
  savs: string[];
  apskritys: string[];
  sources: string[];
  bbox?: Bbox | null;
  excludeHost?: boolean;
  excludeJar?: boolean;
  excludeExt?: boolean;
  excludeAuthor?: boolean;
  excludeCreator?: boolean;
  excludeProducer?: boolean;
  excludeType?: boolean;
  excludeLang?: boolean;
  excludeSav?: boolean;
  excludeApskritis?: boolean;
  excludeSource?: boolean;
  /** Tiksli frazė: tekstą paduodam Quickwit'ui kabutėse ("…"), kad žodžiai būtų
   *  randami tiksliai greta ir ta pačia tvarka, o ne kaip atskiri terminai. */
  phrase?: boolean;
}): string {
  const { textQuery, types, hosts, jars, exts, authors, creators, producers, langs, savs, apskritys, sources, bbox } = opts;
  const p: string[] = [];
  if (!opts.excludeType && types.length) p.push(`(${types.map((t) => `type:${t}`).join(' OR ')})`);
  if (!opts.excludeHost && hosts.length) p.push(`(${hosts.map((h) => `host:${JSON.stringify(h)}`).join(' OR ')})`);
  if (!opts.excludeJar && jars.length) {
    const numeric = jars.map((j) => parseInt(j, 10)).filter((n) => Number.isFinite(n));
    if (numeric.length) p.push(`(${numeric.map((n) => `jarKodai:${n}`).join(' OR ')})`);
  }
  if (!opts.excludeExt && exts.length) p.push(`(${exts.map((e) => `extension:${JSON.stringify(e)}`).join(' OR ')})`);
  if (!opts.excludeAuthor && authors.length) p.push(`(${authors.map((v) => `author:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeCreator && creators.length) p.push(`(${creators.map((v) => `metadata.creator:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeProducer && producers.length) p.push(`(${producers.map((v) => `metadata.producer:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeLang && langs.length) p.push(`(${langs.map((l) => `language:${JSON.stringify(l)}`).join(' OR ')})`);
  if (!opts.excludeSav && savs.length) p.push(`(${savs.map((s) => `savivaldybe:${JSON.stringify(s)}`).join(' OR ')})`);
  if (!opts.excludeApskritis && apskritys.length) p.push(`(${apskritys.map((a) => `apskritis:${JSON.stringify(a)}`).join(' OR ')})`);
  if (!opts.excludeSource && sources.length) p.push(`(${sources.map((s) => `source:${JSON.stringify(s)}`).join(' OR ')})`);
  // Sritis: dokumentai, kurių taškas patenka į pasirinktą stačiakampį. Filtruojam
  // per Quickwit lat/lon fast laukų range užklausą (inkliuzyvūs rėžiai).
  if (bbox) {
    p.push(`lat:[${bbox.minLat} TO ${bbox.maxLat}]`);
    p.push(`lon:[${bbox.minLon} TO ${bbox.maxLon}]`);
  }
  if (textQuery) {
    const folded = foldLithuanian(textQuery.replace(/"/g, ''));
    p.push(opts.phrase ? `"${folded}"` : `(${folded})`);
  }
  return p.join(' AND ') || '*';
}

/** Parse the four area params into a valid Bbox, or null if absent/invalid. */
function parseBbox(input: {
  minLat?: string | number;
  maxLat?: string | number;
  minLon?: string | number;
  maxLon?: string | number;
}): Bbox | null {
  const n = (v: string | number | undefined) => {
    const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
    return Number.isFinite(x) ? x : null;
  };
  const minLat = n(input.minLat), maxLat = n(input.maxLat);
  const minLon = n(input.minLon), maxLon = n(input.maxLon);
  if (minLat == null || maxLat == null || minLon == null || maxLon == null) return null;
  return {
    minLat: Math.min(minLat, maxLat),
    maxLat: Math.max(minLat, maxLat),
    minLon: Math.min(minLon, maxLon),
    maxLon: Math.max(minLon, maxLon),
  };
}

// Shared filter/query parts for a request — used both by the full search and by
// the standalone facet-options fetch (the "show all" modal).
function buildPartsOpts(input: {
  q?: string;
  type?: string | string[];
  host?: string | string[];
  jar?: string | string[];
  ext?: string | string[];
  author?: string | string[];
  creator?: string | string[];
  producer?: string | string[];
  lang?: string | string[];
  sav?: string | string[];
  apskritis?: string | string[];
  source?: string | string[];
  minLat?: string | number;
  maxLat?: string | number;
  minLon?: string | number;
  maxLon?: string | number;
  mode?: string;
}) {
  const rawQ = (input.q ?? '').trim();
  const phrase = input.mode === 'phrase';

  const typeFilter = splitMulti(input.type);
  const hostFilter = splitMulti(input.host);
  const jarFilter = splitMulti(input.jar);
  const extFilter = splitMulti(input.ext).map((e) => e.toLowerCase().replace(/^\./, ''));
  const authorFilter = Array.isArray(input.author) ? input.author.filter(Boolean) : input.author ? [input.author] : [];
  const creatorFilter = Array.isArray(input.creator) ? input.creator.filter(Boolean) : input.creator ? [input.creator] : [];
  const producerFilter = Array.isArray(input.producer) ? input.producer.filter(Boolean) : input.producer ? [input.producer] : [];
  const langFilter = splitMulti(input.lang);
  const savFilter = splitMulti(input.sav);
  const apskritisFilter = splitMulti(input.apskritis);
  const sourceFilter = splitMulti(input.source).map(canonSource);

  const { textQuery, types: inlineTypes, hosts: inlineHosts, jars: inlineJars, exts: inlineExts } =
    extractInlineTokens(rawQ);

  return {
    textQuery,
    types: [...new Set([...inlineTypes, ...typeFilter])],
    hosts: [...new Set([...inlineHosts, ...hostFilter])],
    jars: [...new Set([...inlineJars, ...jarFilter])],
    exts: [...new Set([...inlineExts, ...extFilter.map((e) => e.toLowerCase())])],
    authors: [...new Set(authorFilter)],
    creators: [...new Set(creatorFilter)],
    producers: [...new Set(producerFilter)],
    langs: [...new Set(langFilter)],
    savs: [...new Set(savFilter)],
    apskritys: [...new Set(apskritisFilter)],
    sources: [...new Set(sourceFilter)],
    bbox: parseBbox(input),
    phrase,
  };
}

// Quickwit field → the "exclude this facet's own filter" flag, so a facet lists
// every value available under the *other* active filters.
type FacetExcludeKey =
  | 'excludeHost' | 'excludeExt' | 'excludeAuthor' | 'excludeCreator' | 'excludeProducer' | 'excludeLang'
  | 'excludeSav' | 'excludeApskritis' | 'excludeSource';
const FACET_EXCLUDE: Record<string, FacetExcludeKey> = {
  host: 'excludeHost',
  extension: 'excludeExt',
  author: 'excludeAuthor',
  'metadata.creator': 'excludeCreator',
  'metadata.producer': 'excludeProducer',
  language: 'excludeLang',
  savivaldybe: 'excludeSav',
  apskritis: 'excludeApskritis',
  source: 'excludeSource',
};

/**
 * Full option list for a single facet under the current query/filters. Powers
 * the "show all" modal, so `size` can be large (up to ~1k) — far beyond the few
 * rows the sidebar previews.
 */
export async function dokumentaiFacetOptions(
  field: string,
  input: Parameters<typeof buildPartsOpts>[0],
  size = 1000,
): Promise<FacetOption[]> {
  const excludeKey = FACET_EXCLUDE[field];
  if (!excludeKey) return [];
  const partsOpts = buildPartsOpts(input);
  const query = buildPartsExcluding({ ...partsOpts, [excludeKey]: true });
  const buckets = await qwAggregate(field, query, size);
  return buckets.filter((b) => b.value).map((b) => ({ value: b.value, count: b.count }));
}

// ── Snippets ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// ── Public API ───────────────────────────────────────────────────────────────

export async function searchDokumentai(input: {
  q?: string;
  page?: number;
  type?: string | string[];
  host?: string | string[];
  jar?: string | string[];
  ext?: string | string[];
  author?: string | string[];
  creator?: string | string[];
  producer?: string | string[];
  lang?: string | string[];
  sav?: string | string[];
  apskritis?: string | string[];
  source?: string | string[];
  minLat?: string | number;
  maxLat?: string | number;
  minLon?: string | number;
  maxLon?: string | number;
  sort?: string;
  /** 'phrase' = tiksli frazė (kabutėse), 'words' (numatyta) = atskiri žodžiai. */
  mode?: string;
}): Promise<DokumentaiSearchResult> {
  const rawQ = (input.q ?? '').trim();
  const page = Math.max(1, Number(input.page) || 1);
  const phrase = input.mode === 'phrase';
  const sort = resolveSort(input.sort);
  const sortBy = DOKUMENTAI_SORT_MAP.get(sort)!;

  const partsOpts = buildPartsOpts(input);
  const { textQuery } = partsOpts;

  const qwQuery = buildPartsExcluding(partsOpts);
  const hostFacetQuery = buildPartsExcluding({ ...partsOpts, excludeHost: true });
  const typeFacetQuery = buildPartsExcluding(partsOpts);
  const extFacetQuery = buildPartsExcluding({ ...partsOpts, excludeExt: true });
  const authorFacetQuery = buildPartsExcluding({ ...partsOpts, excludeAuthor: true });
  const creatorFacetQuery = buildPartsExcluding({ ...partsOpts, excludeCreator: true });
  const producerFacetQuery = buildPartsExcluding({ ...partsOpts, excludeProducer: true });
  const langFacetQuery = buildPartsExcluding({ ...partsOpts, excludeLang: true });
  const savFacetQuery = buildPartsExcluding({ ...partsOpts, excludeSav: true });
  const apskritisFacetQuery = buildPartsExcluding({ ...partsOpts, excludeApskritis: true });
  const sourceFacetQuery = buildPartsExcluding({ ...partsOpts, excludeSource: true });

  const t0 = Date.now();
  const mark = () => Date.now() - t0;
  const timings: Timing[] = [];

  // Main hit search and the facet aggregations all hit Quickwit concurrently;
  // time the hit search and the facet block as two overlapping phases so the
  // waterfall shows where the wallclock actually goes.
  const searchStart = mark();
  const searchPromise = search(
    LENTELE,
    { query: qwQuery, sort_by: sortBy },
    { minHits: page * PAGE_SIZE },
  );
  const aggsStart = mark();
  const aggsPromise = Promise.all([
    qwAggregate('host', hostFacetQuery, 15),
    qwAggregate('type', typeFacetQuery, 10),
    // Sidebar previews only 6 extensions; +1 is enough to know whether to show
    // the "Daugiau" button. The full list is fetched on demand by the modal
    // (/api/dokumentaiFacet), so there's no need to over-aggregate here.
    qwAggregate('extension', extFacetQuery, 7),
    qwAggregate('author', authorFacetQuery, 8),
    // Creator/producer commonly contain an empty-string bucket. Fetch one
    // extra so, after empty values are removed, the sidebar still knows there
    // are more than six values and can show the shared "Daugiau" modal.
    qwAggregate('metadata.creator', creatorFacetQuery, 8),
    qwAggregate('metadata.producer', producerFacetQuery, 8),
    qwAggregate('language', langFacetQuery, 12),
    qwAggregate('savivaldybe', savFacetQuery, 60),
    qwAggregate('apskritis', apskritisFacetQuery, 12),
    qwAggregate('source', sourceFacetQuery, 12),
  ]);

  const result = await searchPromise;
  // search() splits its own time between the Quickwit query (qwMs) and the
  // Postgres tombstone check that keeps only still-live hits (filterMs). Surface
  // them as separate phases so the waterfall shows how much is the alive-check.
  const qwMs = result.qwMs ?? (mark() - searchStart);
  const filterMs = result.filterMs ?? 0;
  timings.push({ label: 'Paieška', phase: 'search', start: searchStart, duration: qwMs });
  if (filterMs > 0) {
    timings.push({ label: 'Gyvų atranka', phase: 'pg', start: searchStart + qwMs, duration: filterMs });
  }
  const [hostBuckets, typeBuckets, extBuckets, authorBuckets, creatorBuckets, producerBuckets, langBuckets, savBuckets, apskritisBuckets, sourceBuckets] = await aggsPromise;
  timings.push({ label: 'Facetai', phase: 'filter', start: aggsStart, duration: mark() - aggsStart });

  const total = result.numHitsEstimate ?? result.hits.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHits = result.hits.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Hydrate with Postgres
  const ids = pageHits.map((h: any) => Number(h.id)).filter((n: number) => Number.isFinite(n));
  let rows: DokumentasHit[] = [];
  if (ids.length) {
    const pgStart = mark();
    const { rows: pgRows } = await postgres.query(
      `SELECT
         id, md5, type, url, host, domain, source, pavadinimas, autorius,
         extension, language, "pageCount", "wordCount", "characterCount",
         savivaldybe, apskritis, "istaigaJar",
         "happenedAt", "createdAt", "updatedAt", "discoveredAt", "failasId"
       FROM public.dokumentai
       WHERE id = ANY($1)`,
      [ids],
    );
    timings.push({ label: 'Duomenys', phase: 'pg', start: pgStart, duration: mark() - pgStart });
    const byId = new Map<number, any>(pgRows.map((r: any) => [Number(r.id), r]));
    rows = ids
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((r: any) => ({
        ...r,
        title: r.pavadinimas ?? null,
        snippet: null,
      } as DokumentasHit));

    // Snippets from sidecar JSON
    if (rawQ) {
      const snipStart = mark();
      await Promise.all(
        rows.map(async (row) => {
          if (!row.md5) return;
          try {
            const sidecar: any = await readDokumentasFs(row.md5);
            const text = sidecar?.text;
            if (typeof text === 'string' && text.length) {
              row.snippet = makeSnippet(text, textQuery, phrase ? 'phrase' : 'words');
            }
          } catch { /* sidecar miss is fine */ }
        }),
      );
      timings.push({ label: 'Ištraukos', phase: 'count', start: snipStart, duration: mark() - snipStart });
    }
  }

  const elapsed = (mark() / 1000).toFixed(2);

  // Pagination window of length WINDOW around current page
  const half = Math.floor(PAGINATION_WINDOW / 2);
  let pStart = Math.max(1, page - half);
  let pEnd = Math.min(totalPages, pStart + PAGINATION_WINDOW - 1);
  if (pEnd - pStart < PAGINATION_WINDOW - 1) pStart = Math.max(1, pEnd - PAGINATION_WINDOW + 1);
  const pageNums: number[] = [];
  if (totalPages > 0) for (let i = pStart; i <= pEnd; i++) pageNums.push(i);

  const toOptions = (buckets: FacetOption[]) =>
    buckets.filter((b) => b.value).map((b) => ({ value: b.value, count: b.count }));

  const hostOptions = toOptions(hostBuckets);
  const typeCountMap = Object.fromEntries(typeBuckets.map((b) => [b.value, b.count ?? 0]));
  const extOptions = toOptions(extBuckets);
  const authorOptions = toOptions(authorBuckets);
  const creatorOptions = toOptions(creatorBuckets);
  const producerOptions = toOptions(producerBuckets);
  const langOptions = toOptions(langBuckets);
  const savOptions = toOptions(savBuckets);
  const apskritisOptions = toOptions(apskritisBuckets);
  // Across shards the `source` fast field is normalized inconsistently (some
  // shards lowercase it, older ones keep raw casing), so the aggregation returns
  // both e.g. `cvpis` and `cvpIs` as separate buckets. Canonicalize, then merge
  // same-canonical buckets — summing counts — so the facet shows one row per
  // source instead of a duplicate "CVP IS" / "MVP tvarkos".
  const sourceCounts = new Map<string, number>();
  for (const b of sourceBuckets) {
    if (!b.value) continue;
    const key = canonSource(b.value);
    sourceCounts.set(key, (sourceCounts.get(key) ?? 0) + (b.count ?? 0));
  }
  const sourceOptions: FacetOption[] = [...sourceCounts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

  return {
    q: rawQ,
    hits: rows,
    total,
    approximate: !result.rawExhausted,
    elapsed,
    engine: 'quickwit',
    timings,
    page,
    totalPages,
    pageNums,
    sort,
    typeFilter: partsOpts.types,
    hostFilter: partsOpts.hosts,
    jarFilter: partsOpts.jars,
    extFilter: partsOpts.exts,
    authorFilter: partsOpts.authors,
    creatorFilter: partsOpts.creators,
    producerFilter: partsOpts.producers,
    langFilter: partsOpts.langs,
    savFilter: partsOpts.savs,
    apskritisFilter: partsOpts.apskritys,
    sourceFilter: partsOpts.sources,
    bbox: partsOpts.bbox,
    typeCountMap,
    hostOptions,
    extOptions,
    authorOptions,
    creatorOptions,
    producerOptions,
    langOptions,
    savOptions,
    apskritisOptions,
    sourceOptions,
  };
}
