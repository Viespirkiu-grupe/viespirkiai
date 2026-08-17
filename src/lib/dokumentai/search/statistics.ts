import { getDeadRatio } from '@/quickwit/quickwit.js';
import { attachIstaigaNames } from './facets.ts';
import { buildPartsExcluding, buildPartsOpts } from './query.ts';
import {
  aggregationOptions,
  DOKUMENTAI_INDEX,
  fetchAggregations,
  mergeSourceBuckets,
} from './quickwitAggregations.ts';
import type { DokumentaiSearchInput, FacetOption } from './types.ts';

export interface HomeSizeMetric {
  key: 'words' | 'pages' | 'chars';
  label: string;
  unit: string;
  percentiles: { p: number; value: number }[];
  median: number;
  coverage: number;
}

export interface DokumentaiHomeOverview {
  total: number;
  totalPages: number;
  totalWords: number;
  byType: FacetOption[];
  byClass: FacetOption[];
  bySource: FacetOption[];
  byExt: FacetOption[];
  topIstaiga: FacetOption[];
  sizeMetrics: HomeSizeMetric[];
}

const HOME_OVERVIEW_TTL_MS = 10 * 60 * 1000;
const SIZE_PERCENTILES = [10, 25, 50, 75, 90, 99];
let homeOverviewCache: { at: number; data: DokumentaiHomeOverview } | null = null;

function buildSizeMetric(
  key: HomeSizeMetric['key'],
  label: string,
  unit: string,
  percentileAggregation: any,
  countAggregation: any,
): HomeSizeMetric | null {
  const values: Record<string, any> = percentileAggregation?.values ?? {};
  const percentiles = SIZE_PERCENTILES
    .map((percentile) => ({
      p: percentile,
      value: Math.round(Number(values[`${percentile}.0`] ?? values[percentile])),
    }))
    .filter((item) => Number.isFinite(item.value) && item.value >= 0);
  if (percentiles.length <= 1) return null;
  if (percentiles[0].value === percentiles[percentiles.length - 1].value) return null;
  const median = percentiles.find((item) => item.p === 50)?.value ?? 0;
  return {
    key,
    label,
    unit,
    percentiles,
    median,
    coverage: Math.round(Number(countAggregation?.value ?? 0)),
  };
}

const EMPTY_OVERVIEW: DokumentaiHomeOverview = {
  total: 0,
  totalPages: 0,
  totalWords: 0,
  byType: [],
  byClass: [],
  bySource: [],
  byExt: [],
  topIstaiga: [],
  sizeMetrics: [],
};

export async function dokumentaiHomeOverview(): Promise<DokumentaiHomeOverview> {
  if (homeOverviewCache && Date.now() - homeOverviewCache.at < HOME_OVERVIEW_TTL_MS) {
    return homeOverviewCache.data;
  }
  try {
    const [response, deadRatio] = await Promise.all([
      fetchAggregations('*', {
        byType: { terms: { field: 'type', size: 10 } },
        byClass: { terms: { field: 'class', size: 10 } },
        bySource: { terms: { field: 'source', size: 12 } },
        byExt: { terms: { field: 'extension', size: 14 } },
        byIstaiga: { terms: { field: 'istaigaJar', size: 8 } },
        wordsPct: { percentiles: { field: 'wordCount', percents: SIZE_PERCENTILES } },
        wordsCnt: { value_count: { field: 'wordCount' } },
        pagesPct: { percentiles: { field: 'pageCount', percents: SIZE_PERCENTILES } },
        pagesCnt: { value_count: { field: 'pageCount' } },
        charsPct: { percentiles: { field: 'characterCount', percents: SIZE_PERCENTILES } },
        charsCnt: { value_count: { field: 'characterCount' } },
        pages: { sum: { field: 'pageCount' } },
        words: { sum: { field: 'wordCount' } },
      }),
      getDeadRatio(DOKUMENTAI_INDEX).catch(() => 0),
    ]);
    if (!response.ok) return EMPTY_OVERVIEW;
    const data: any = await response.json();
    const aggregations = data?.aggregations ?? {};
    const liveRatio = Math.max(0.01, 1 - Number(deadRatio || 0));
    const scale = (count: number) => Math.round(count * liveRatio);
    const sizeMetrics = [
      buildSizeMetric('words', 'Žodžiai', 'žodžių', aggregations.wordsPct, aggregations.wordsCnt),
      buildSizeMetric('pages', 'Puslapiai', 'puslapių', aggregations.pagesPct, aggregations.pagesCnt),
      buildSizeMetric('chars', 'Simboliai', 'simbolių', aggregations.charsPct, aggregations.charsCnt),
    ].filter((metric): metric is HomeSizeMetric => metric !== null);

    const overview: DokumentaiHomeOverview = {
      total: scale(Number(data?.num_hits ?? 0)),
      totalPages: scale(Number(aggregations.pages?.value ?? 0)),
      totalWords: scale(Number(aggregations.words?.value ?? 0)),
      byType: aggregationOptions(aggregations, 'byType', scale),
      byClass: aggregationOptions(aggregations, 'byClass', scale),
      bySource: mergeSourceBuckets(aggregations.bySource?.buckets, scale),
      byExt: aggregationOptions(aggregations, 'byExt', scale),
      topIstaiga: await attachIstaigaNames(aggregationOptions(aggregations, 'byIstaiga', scale)),
      sizeMetrics,
    };
    homeOverviewCache = { at: Date.now(), data: overview };
    return overview;
  } catch {
    return EMPTY_OVERVIEW;
  }
}

export interface StatsTimelineBucket {
  year: number;
  count: number;
}

export interface DokumentaiStats {
  total: number;
  totalPages: number;
  totalWords: number;
  uniqIstaiga: number;
  uniqHost: number;
  timeline: StatsTimelineBucket[];
  activeYears: number[];
  byType: FacetOption[];
  byClass: FacetOption[];
  bySource: FacetOption[];
  topIstaiga: FacetOption[];
  wordsMetric: HomeSizeMetric | null;
  pagesMetric: HomeSizeMetric | null;
}

const NS_PER_MS = 1_000_000;
const STATS_FIRST_YEAR = 2004;

export function buildYearRanges(fromYear: number, toYear: number) {
  const ranges: { key: string; from: number; to: number }[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    ranges.push({
      key: String(year),
      from: Date.UTC(year, 0, 1) * NS_PER_MS,
      to: Date.UTC(year + 1, 0, 1) * NS_PER_MS,
    });
  }
  return ranges;
}

export function parseTimelineBuckets(
  buckets: any[] | undefined,
  scale: (count: number) => number,
): StatsTimelineBucket[] {
  const years = (buckets ?? [])
    .map((bucket) => ({
      year: Number(bucket.key),
      count: scale(Number(bucket.doc_count ?? 0)),
    }))
    .filter((bucket) => Number.isInteger(bucket.year) && bucket.year > 1900)
    .sort((left, right) => left.year - right.year);
  let start = 0;
  let end = years.length - 1;
  while (start <= end && years[start].count === 0) start++;
  while (end >= start && years[end].count === 0) end--;
  return years.slice(start, end + 1);
}

export async function dokumentaiFilterStats(
  input: DokumentaiSearchInput,
  knownTotal?: number,
): Promise<DokumentaiStats | null> {
  try {
    const parts = buildPartsOpts(input);
    const mainQuery = buildPartsExcluding(parts);
    const timelineQuery = buildPartsExcluding({ ...parts, excludeMetai: true });
    const sameScope = timelineQuery === mainQuery;
    const timelineAggregation = {
      range: {
        field: 'happenedAt',
        ranges: buildYearRanges(STATS_FIRST_YEAR, new Date().getUTCFullYear()),
      },
    };
    const mainAggregations: Record<string, unknown> = {
      pages: { sum: { field: 'pageCount' } },
      words: { sum: { field: 'wordCount' } },
      byType: { terms: { field: 'type', size: 8 } },
      byClass: { terms: { field: 'class', size: 6 } },
      bySource: { terms: { field: 'source', size: 10 } },
      byIstaiga: { terms: { field: 'istaigaJar', size: 6 } },
      uniqIstaiga: { cardinality: { field: 'istaigaJar' } },
      uniqHost: { cardinality: { field: 'host' } },
      wordsPct: { percentiles: { field: 'wordCount', percents: SIZE_PERCENTILES } },
      wordsCnt: { value_count: { field: 'wordCount' } },
      pagesPct: { percentiles: { field: 'pageCount', percents: SIZE_PERCENTILES } },
      pagesCnt: { value_count: { field: 'pageCount' } },
    };
    if (sameScope) mainAggregations.timeline = timelineAggregation;

    const [response, timelineResponse, deadRatio] = await Promise.all([
      fetchAggregations(mainQuery, mainAggregations),
      sameScope ? Promise.resolve(null) : fetchAggregations(timelineQuery, { timeline: timelineAggregation }),
      getDeadRatio(DOKUMENTAI_INDEX).catch(() => 0),
    ]);
    if (!response.ok) return null;
    const data: any = await response.json();
    const aggregations = data?.aggregations ?? {};
    let timelineBuckets = aggregations.timeline?.buckets;
    if (!sameScope && timelineResponse?.ok) {
      timelineBuckets = (await timelineResponse.json())?.aggregations?.timeline?.buckets;
    }

    const liveRatio = Math.max(0.01, 1 - Number(deadRatio || 0));
    const scale = (count: number) => Math.round(Number(count || 0) * liveRatio);
    return {
      total: knownTotal ?? scale(Number(data?.num_hits ?? 0)),
      totalPages: scale(Number(aggregations.pages?.value ?? 0)),
      totalWords: scale(Number(aggregations.words?.value ?? 0)),
      uniqIstaiga: Math.round(Number(aggregations.uniqIstaiga?.value ?? 0)),
      uniqHost: Math.round(Number(aggregations.uniqHost?.value ?? 0)),
      timeline: parseTimelineBuckets(timelineBuckets, scale),
      activeYears: parts.years.map((year) => parseInt(year, 10)).filter(Number.isFinite),
      byType: aggregationOptions(aggregations, 'byType', scale),
      byClass: aggregationOptions(aggregations, 'byClass', scale),
      bySource: mergeSourceBuckets(aggregations.bySource?.buckets, scale),
      topIstaiga: await attachIstaigaNames(aggregationOptions(aggregations, 'byIstaiga', scale)),
      wordsMetric: buildSizeMetric('words', 'Žodžiai', 'žodžių', aggregations.wordsPct, aggregations.wordsCnt),
      pagesMetric: buildSizeMetric('pages', 'Puslapiai', 'puslapių', aggregations.pagesPct, aggregations.pagesCnt),
    };
  } catch {
    return null;
  }
}
