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

export interface DokumentasHit {
  id: number;
  md5: string | null;
  type: string | null;
  url: string | null;
  host: string | null;
  domain: string | null;
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
  page: number;
  totalPages: number;
  pageNums: number[];
  typeFilter: string[];
  hostFilter: string[];
  jarFilter: string[];
  extFilter: string[];
  langFilter: string[];
  savFilter: string[];
  apskritisFilter: string[];
  sourceFilter: string[];
  typeCountMap: Record<string, number>;
  hostOptions: FacetOption[];
  extOptions: FacetOption[];
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

function buildPartsExcluding(opts: {
  textQuery: string;
  types: string[];
  hosts: string[];
  jars: string[];
  exts: string[];
  langs: string[];
  savs: string[];
  apskritys: string[];
  sources: string[];
  excludeHost?: boolean;
  excludeJar?: boolean;
  excludeExt?: boolean;
  excludeType?: boolean;
  excludeLang?: boolean;
  excludeSav?: boolean;
  excludeApskritis?: boolean;
  excludeSource?: boolean;
}): string {
  const { textQuery, types, hosts, jars, exts, langs, savs, apskritys, sources } = opts;
  const p: string[] = [];
  if (!opts.excludeType && types.length) p.push(`(${types.map((t) => `type:${t}`).join(' OR ')})`);
  if (!opts.excludeHost && hosts.length) p.push(`(${hosts.map((h) => `host:${JSON.stringify(h)}`).join(' OR ')})`);
  if (!opts.excludeJar && jars.length) {
    const numeric = jars.map((j) => parseInt(j, 10)).filter((n) => Number.isFinite(n));
    if (numeric.length) p.push(`(${numeric.map((n) => `jarKodai:${n}`).join(' OR ')})`);
  }
  if (!opts.excludeExt && exts.length) p.push(`(${exts.map((e) => `extension:${JSON.stringify(e)}`).join(' OR ')})`);
  if (!opts.excludeLang && langs.length) p.push(`(${langs.map((l) => `language:${JSON.stringify(l)}`).join(' OR ')})`);
  if (!opts.excludeSav && savs.length) p.push(`(${savs.map((s) => `savivaldybe:${JSON.stringify(s)}`).join(' OR ')})`);
  if (!opts.excludeApskritis && apskritys.length) p.push(`(${apskritys.map((a) => `apskritis:${JSON.stringify(a)}`).join(' OR ')})`);
  if (!opts.excludeSource && sources.length) p.push(`(${sources.map((s) => `source:${JSON.stringify(s)}`).join(' OR ')})`);
  if (textQuery) {
    const folded = foldLithuanian(textQuery.replace(/"/g, ''));
    p.push(`(${folded})`);
  }
  return p.join(' AND ') || '*';
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
      out.push(...m[1].split(/\s+/).filter((w) => w.length > 1));
    } else {
      const tok = m[2];
      if (/^\w+:/.test(tok)) continue;
      if (tok.length > 1) out.push(tok);
    }
  }
  return out;
}

function makeSnippet(text: string, q: string, maxChars = 240, leading = 80): string | null {
  if (!text) return null;
  const terms = extractTerms(q);
  const term = terms.find((t) => t.length > 2) ?? terms[0];

  let start = 0;
  if (term) {
    const folded = foldLithuanian(text).toLowerCase();
    const idx = folded.indexOf(foldLithuanian(term).toLowerCase());
    if (idx >= 0) start = Math.max(0, idx - leading);
  }
  let s = text.slice(start, start + maxChars).replace(/\s+/g, ' ').trim();
  if (start > 0) s = '…' + s;
  if (start + maxChars < text.length) s += '…';
  s = escapeHtml(s);
  if (terms.length) {
    const re = new RegExp(
      `(${terms.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
      'gi',
    );
    s = s.replace(re, '<strong>$1</strong>');
  }
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
  lang?: string | string[];
  sav?: string | string[];
  apskritis?: string | string[];
  source?: string | string[];
}): Promise<DokumentaiSearchResult> {
  const rawQ = (input.q ?? '').trim();
  const page = Math.max(1, Number(input.page) || 1);

  const typeFilter = splitMulti(input.type);
  const hostFilter = splitMulti(input.host);
  const jarFilter = splitMulti(input.jar);
  const extFilter = splitMulti(input.ext).map((e) => e.toLowerCase().replace(/^\./, ''));
  const langFilter = splitMulti(input.lang);
  const savFilter = splitMulti(input.sav);
  const apskritisFilter = splitMulti(input.apskritis);
  const sourceFilter = splitMulti(input.source).map(canonSource);

  const { textQuery, types: inlineTypes, hosts: inlineHosts, jars: inlineJars, exts: inlineExts } =
    extractInlineTokens(rawQ);

  const allTypes = [...new Set([...inlineTypes, ...typeFilter])];
  const allHosts = [...new Set([...inlineHosts, ...hostFilter])];
  const allJars = [...new Set([...inlineJars, ...jarFilter])];
  const allExts = [...new Set([...inlineExts, ...extFilter.map((e) => e.toLowerCase())])];
  const allLangs = [...new Set(langFilter)];
  const allSavs = [...new Set(savFilter)];
  const allApskritys = [...new Set(apskritisFilter)];
  const allSources = [...new Set(sourceFilter)];

  const partsOpts = {
    textQuery,
    types: allTypes,
    hosts: allHosts,
    jars: allJars,
    exts: allExts,
    langs: allLangs,
    savs: allSavs,
    apskritys: allApskritys,
    sources: allSources,
  };

  const qwQuery = buildPartsExcluding(partsOpts);
  const hostFacetQuery = buildPartsExcluding({ ...partsOpts, excludeHost: true });
  const typeFacetQuery = buildPartsExcluding(partsOpts);
  const extFacetQuery = buildPartsExcluding({ ...partsOpts, excludeExt: true });
  const langFacetQuery = buildPartsExcluding({ ...partsOpts, excludeLang: true });
  const savFacetQuery = buildPartsExcluding({ ...partsOpts, excludeSav: true });
  const apskritisFacetQuery = buildPartsExcluding({ ...partsOpts, excludeApskritis: true });
  const sourceFacetQuery = buildPartsExcluding({ ...partsOpts, excludeSource: true });

  const t0 = Date.now();
  const [result, hostBuckets, typeBuckets, extBuckets, langBuckets, savBuckets, apskritisBuckets, sourceBuckets] = await Promise.all([
    search(LENTELE, { query: qwQuery }, { minHits: page * PAGE_SIZE }),
    qwAggregate('host', hostFacetQuery, 15),
    qwAggregate('type', typeFacetQuery, 10),
    qwAggregate('extension', extFacetQuery, 30),
    qwAggregate('language', langFacetQuery, 12),
    qwAggregate('savivaldybe', savFacetQuery, 60),
    qwAggregate('apskritis', apskritisFacetQuery, 12),
    qwAggregate('source', sourceFacetQuery, 12),
  ]);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);

  const total = result.numHitsEstimate ?? result.hits.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHits = result.hits.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Hydrate with Postgres
  const ids = pageHits.map((h: any) => Number(h.id)).filter((n: number) => Number.isFinite(n));
  let rows: DokumentasHit[] = [];
  if (ids.length) {
    const { rows: pgRows } = await postgres.query(
      `SELECT
         id, md5, type, url, host, domain, pavadinimas, autorius,
         extension, language, "pageCount", "wordCount", "characterCount",
         savivaldybe, apskritis, "istaigaJar",
         "happenedAt", "createdAt", "failasId"
       FROM public.dokumentai
       WHERE id = ANY($1)`,
      [ids],
    );
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
      await Promise.all(
        rows.map(async (row) => {
          if (!row.md5) return;
          try {
            const sidecar: any = await readDokumentasFs(row.md5);
            const text = sidecar?.text;
            if (typeof text === 'string' && text.length) {
              row.snippet = makeSnippet(text, rawQ);
            }
          } catch { /* sidecar miss is fine */ }
        }),
      );
    }
  }

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
  const langOptions = toOptions(langBuckets);
  const savOptions = toOptions(savBuckets);
  const apskritisOptions = toOptions(apskritisBuckets);
  const sourceOptions = toOptions(sourceBuckets).map((o) => ({ ...o, value: canonSource(o.value) }));

  return {
    q: rawQ,
    hits: rows,
    total,
    approximate: !result.rawExhausted,
    elapsed,
    page,
    totalPages,
    pageNums,
    typeFilter: allTypes,
    hostFilter: allHosts,
    jarFilter: allJars,
    extFilter: allExts,
    langFilter: allLangs,
    savFilter: allSavs,
    apskritisFilter: allApskritys,
    sourceFilter: allSources,
    typeCountMap,
    hostOptions,
    extOptions,
    langOptions,
    savOptions,
    apskritisOptions,
    sourceOptions,
  };
}
