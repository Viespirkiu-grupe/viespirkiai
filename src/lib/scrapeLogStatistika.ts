import { searchIndexPattern } from '@/quickwit/qwHttp.js';
import { SCRAPE_LOG_INDEX_PATTERN } from '@/quickwit/scrapeLogIngest.js';
import type { FacetOption } from './searchDokumentai.ts';

export interface ScrapeLogPeriod {
  key: string;
  label: string;
  seconds: number;
}

export const SCRAPE_LOG_PERIODS: ScrapeLogPeriod[] = [
  { key: '1h', label: 'Paskutinė valanda', seconds: 3_600 },
  { key: '6h', label: 'Paskutinės 6 val.', seconds: 21_600 },
  { key: '24h', label: 'Paskutinė para', seconds: 86_400 },
  { key: '7d', label: 'Paskutinės 7 d.', seconds: 604_800 },
  { key: '30d', label: 'Paskutinės 30 d.', seconds: 2_592_000 },
];

export const SCRAPE_LOG_PAGE_SIZE = 50;
const MAX_PAGE = 200;

const FACET_FIELDS = ['scraper', 'operation', 'domain', 'host', 'status', 'method', 'env', 'role', 'ok'] as const;
export type ScrapeLogFacet = typeof FACET_FIELDS[number];

export interface ScrapeLogFilters {
  search: string;
  period: ScrapeLogPeriod;
  page: number;
  scraper: string[];
  operation: string[];
  domain: string[];
  host: string[];
  status: string[];
  method: string[];
  env: string[];
  role: string[];
  ok: string[];
}

export interface ScrapeLogRow {
  ts: string;
  requestId: string;
  scraper: string;
  operation: string;
  method: string;
  scheme: string;
  host: string;
  domain: string;
  path: string;
  status: number | null;
  ok: boolean;
  ttfbMs: number;
  ms: number;
  bytes: number;
  errorName?: string;
  errorCode?: string;
  role?: string;
  env?: string;
}

export interface ScrapeLogSummary {
  requests: number;
  errors: number;
  bytes: number;
  avgMs: number;
  p95Ms: number | null;
  avgTtfbMs: number;
}

const split = (value: string | null) =>
  (value ?? '').split(',').map((v) => v.trim()).filter(Boolean);

export function parseScrapeLogFilters(params: URLSearchParams): ScrapeLogFilters {
  const period = SCRAPE_LOG_PERIODS.find((p) => p.key === params.get('laikotarpis'))
    ?? SCRAPE_LOG_PERIODS.find((p) => p.key === '24h')!;
  const rawPage = Number.parseInt(params.get('page') ?? '', 10);
  return {
    search: (params.get('search') ?? '').trim(),
    period,
    page: Number.isFinite(rawPage) ? Math.min(MAX_PAGE, Math.max(1, rawPage)) : 1,
    scraper: split(params.get('scraper')),
    operation: split(params.get('operation')),
    domain: split(params.get('domain')),
    host: split(params.get('host')),
    status: split(params.get('status')),
    method: split(params.get('method')),
    env: split(params.get('env')),
    role: split(params.get('role')),
    ok: split(params.get('ok')),
  };
}

function quote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

export function buildScrapeLogQuery(filters: ScrapeLogFilters, exclude?: ScrapeLogFacet): string {
  const parts: string[] = [];
  if (filters.search) parts.push(`(${filters.search})`);
  for (const field of FACET_FIELDS) {
    if (field === exclude) continue;
    const selected = filters[field];
    if (!selected.length) continue;
    const values = selected.map((value) => {
      if (field === 'status' && /^\d+$/.test(value)) return `${field}:${value}`;
      if (field === 'ok' && /^(true|false)$/.test(value)) return `${field}:${value}`;
      return `${field}:${quote(value)}`;
    });
    parts.push(values.length === 1 ? values[0] : `(${values.join(' OR ')})`);
  }
  return parts.length ? parts.join(' AND ') : '*';
}

function timeRange(period: ScrapeLogPeriod) {
  const end = Math.floor(Date.now() / 1_000);
  return { start_timestamp: end - period.seconds, end_timestamp: end };
}

const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

async function facetOptions(filters: ScrapeLogFilters, field: ScrapeLogFacet): Promise<FacetOption[]> {
  const response: any = await searchIndexPattern(SCRAPE_LOG_INDEX_PATTERN, {
    query: buildScrapeLogQuery(filters, field),
    max_hits: 0,
    ...timeRange(filters.period),
    aggs: { values: { terms: { field, size: 50 } } },
    format: 'json',
  });
  return (response?.aggregations?.values?.buckets ?? []).map((bucket: any) => ({
    value: field === 'ok'
      ? String(bucket.key_as_string ?? Boolean(bucket.key))
      : String(bucket.key),
    count: number(bucket.doc_count),
  }));
}

export async function searchScrapeLog(filters: ScrapeLogFilters): Promise<{
  rows: ScrapeLogRow[];
  total: number;
  summary: ScrapeLogSummary;
  facets: Record<ScrapeLogFacet, FacetOption[]>;
}> {
  const query = buildScrapeLogQuery(filters);
  const range = timeRange(filters.period);
  const facetPromises = Object.fromEntries(
    FACET_FIELDS.map((field) => [field, facetOptions(filters, field)]),
  ) as Record<ScrapeLogFacet, Promise<FacetOption[]>>;

  const [hitsResponse, summaryResponse, ...facetValues]: any[] = await Promise.all([
    searchIndexPattern(SCRAPE_LOG_INDEX_PATTERN, {
      query,
      max_hits: SCRAPE_LOG_PAGE_SIZE,
      start_offset: (filters.page - 1) * SCRAPE_LOG_PAGE_SIZE,
      sort_by: '-ts',
      ...range,
      format: 'json',
    }),
    searchIndexPattern(SCRAPE_LOG_INDEX_PATTERN, {
      query,
      max_hits: 0,
      ...range,
      aggs: {
        bytes: { sum: { field: 'bytes' } },
        avgMs: { avg: { field: 'ms' } },
        avgTtfbMs: { avg: { field: 'ttfbMs' } },
        percentiles: { percentiles: { field: 'ms', percents: [95] } },
        ok: { terms: { field: 'ok', size: 2 } },
      },
      format: 'json',
    }),
    ...FACET_FIELDS.map((field) => facetPromises[field]),
  ]);

  const aggregations = summaryResponse?.aggregations ?? {};
  const percentileValues = aggregations.percentiles?.values ?? {};
  const p95 = percentileValues['95'] ?? percentileValues['95.0'];
  const facets = Object.fromEntries(
    FACET_FIELDS.map((field, index) => [field, facetValues[index] ?? []]),
  ) as Record<ScrapeLogFacet, FacetOption[]>;

  return {
    rows: (hitsResponse?.hits ?? []) as ScrapeLogRow[],
    total: number(hitsResponse?.num_hits),
    summary: {
      requests: number(summaryResponse?.num_hits),
      errors: number((aggregations.ok?.buckets ?? []).find((b: any) => b.key === false || b.key === 0)?.doc_count),
      bytes: number(aggregations.bytes?.value),
      avgMs: number(aggregations.avgMs?.value),
      p95Ms: typeof p95 === 'number' && Number.isFinite(p95) ? p95 : null,
      avgTtfbMs: number(aggregations.avgTtfbMs?.value),
    },
    facets,
  };
}
