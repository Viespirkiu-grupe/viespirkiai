import { search } from '@/quickwit/quickwit.js';
import {
  attachIstaigaNames,
  fetchSearchFacets,
  mergeSourceBuckets,
  toOptions,
  withSelected,
} from './facets.ts';
import { hydrateHits } from './hydrateHits.ts';
import { buildPartsExcluding, buildPartsOpts } from './query.ts';
import { DOKUMENTAI_INDEX } from './quickwitAggregations.ts';
import {
  DOKUMENTAI_SORT_OPTIONS,
  type DokumentaiSearchInput,
  type DokumentaiSearchResult,
  type DokumentaiSort,
  type Timing,
} from './types.ts';

const PAGE_SIZE = 10;
const PAGINATION_WINDOW = 8;
const SORT_MAP = new Map<string, string>(
  DOKUMENTAI_SORT_OPTIONS.map((option) => [option.value, option.sortBy]),
);

function resolveSort(raw: string | undefined): DokumentaiSort {
  return SORT_MAP.has(raw ?? '') ? raw as DokumentaiSort : 'relevance';
}

function paginationNumbers(page: number, totalPages: number): number[] {
  const half = Math.floor(PAGINATION_WINDOW / 2);
  let start = Math.max(1, page - half);
  const end = Math.min(totalPages, start + PAGINATION_WINDOW - 1);
  if (end - start < PAGINATION_WINDOW - 1) {
    start = Math.max(1, end - PAGINATION_WINDOW + 1);
  }
  const numbers: number[] = [];
  for (let value = start; value <= end; value++) numbers.push(value);
  return numbers;
}

export async function searchDokumentai(
  input: DokumentaiSearchInput,
): Promise<DokumentaiSearchResult> {
  const rawQuery = (input.q ?? '').trim();
  const page = Math.max(1, Number(input.page) || 1);
  const phrase = input.mode === 'phrase';
  const sort = resolveSort(input.sort);
  let sortBy = SORT_MAP.get(sort)!;
  const parts = buildPartsOpts(input);
  const { textQuery } = parts;

  if (sort === 'relevance' && (!textQuery || textQuery === '*')) sortBy = 'id';

  const query = buildPartsExcluding(parts);
  const startedAt = Date.now();
  const mark = () => Date.now() - startedAt;
  const timings: Timing[] = [];

  const searchStart = mark();
  const searchPromise = search(
    DOKUMENTAI_INDEX,
    { query, sort_by: sortBy },
    { minHits: page * PAGE_SIZE },
  );
  const facetsStart = mark();
  const facetsPromise = fetchSearchFacets(parts);

  const result = await searchPromise;
  const quickwitDuration = result.qwMs ?? (mark() - searchStart);
  const filterDuration = result.filterMs ?? 0;
  timings.push({
    label: 'Paieška',
    phase: 'search',
    start: searchStart,
    duration: quickwitDuration,
  });
  if (filterDuration > 0) {
    timings.push({
      label: 'Gyvų atranka',
      phase: 'pg',
      start: searchStart + quickwitDuration,
      duration: filterDuration,
    });
  }

  const facetBuckets = await facetsPromise;
  timings.push({
    label: 'Facetai',
    phase: 'filter',
    start: facetsStart,
    duration: mark() - facetsStart,
  });

  const total = result.numHitsEstimate ?? result.hits.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHits = result.hits.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const ids = pageHits
    .map((hit: any) => Number(hit.id))
    .filter((id: number) => Number.isFinite(id));
  const hydrated = await hydrateHits(ids, textQuery, phrase, mark);
  timings.push(...hydrated.timings);
  // Preserve the original definition: search latency ends after hydration and
  // snippet generation, before the small institution-label enrichment queries.
  const elapsed = (mark() / 1000).toFixed(2);

  const hostOptions = toOptions(facetBuckets.host ?? []);
  const jarOptions = await attachIstaigaNames(withSelected(
    toOptions(facetBuckets.jar ?? []),
    parts.jars,
  ));
  const istaigaJarOptions = await attachIstaigaNames(withSelected(
    toOptions(facetBuckets.istaiga ?? []),
    parts.istaigos,
  ));
  const typeCountMap = Object.fromEntries(
    (facetBuckets.type ?? []).map((bucket) => [bucket.value, bucket.count ?? 0]),
  );
  const classCountMap = Object.fromEntries(
    (facetBuckets.class ?? []).map((bucket) => [bucket.value, bucket.count ?? 0]),
  );

  return {
    q: rawQuery,
    hits: hydrated.rows,
    total,
    approximate: !result.rawExhausted,
    elapsed,
    engine: 'quickwit',
    timings,
    page,
    totalPages,
    pageNums: paginationNumbers(page, totalPages),
    sort,
    classFilter: parts.classes,
    typeFilter: parts.types,
    hostFilter: parts.hosts,
    jarFilter: parts.jars,
    istaigaJarFilter: parts.istaigos,
    extFilter: parts.exts,
    authorFilter: parts.authors,
    creatorFilter: parts.creators,
    producerFilter: parts.producers,
    langFilter: parts.langs,
    savFilter: parts.savs,
    apskritisFilter: parts.apskritys,
    sourceFilter: parts.sources,
    metaiFilter: parts.years,
    courtFilter: parts.courts,
    caseTypeFilter: parts.caseTypes,
    categoryFilter: parts.categories,
    judgeFilter: parts.judges,
    actTypeFilter: parts.actTypes,
    validityFilter: parts.validities,
    editionTypeFilter: parts.editionTypes,
    projectStatusFilter: parts.projectStatuses,
    eurovocFilter: parts.eurovoc,
    adoptedByFilter: parts.adoptedBy,
    contentStateFilter: parts.contentStates,
    institutionNumberFilter: parts.institutionNumbers,
    registrationNumberFilter: parts.registrationNumbers,
    dateFrom: parts.dateFrom,
    dateTo: parts.dateTo,
    bbox: parts.bbox,
    typeCountMap,
    classCountMap,
    hostOptions,
    jarOptions,
    istaigaJarOptions,
    extOptions: toOptions(facetBuckets.ext ?? []),
    authorOptions: toOptions(facetBuckets.author ?? []),
    creatorOptions: toOptions(facetBuckets.creator ?? []),
    producerOptions: toOptions(facetBuckets.producer ?? []),
    langOptions: toOptions(facetBuckets.lang ?? []),
    savOptions: toOptions(facetBuckets.sav ?? []),
    apskritisOptions: toOptions(facetBuckets.apskritis ?? []),
    sourceOptions: mergeSourceBuckets(facetBuckets.source),
    courtOptions: toOptions(facetBuckets.court ?? []),
    caseTypeOptions: toOptions(facetBuckets.caseType ?? []),
    categoryOptions: toOptions(facetBuckets.category ?? []),
    judgeOptions: toOptions(facetBuckets.judge ?? []),
    actTypeOptions: toOptions(facetBuckets.actType ?? []),
    validityOptions: toOptions(facetBuckets.validity ?? []),
    editionTypeOptions: toOptions(facetBuckets.editionType ?? []),
    projectStatusOptions: toOptions(facetBuckets.projectStatus ?? []),
    eurovocOptions: toOptions(facetBuckets.eurovoc ?? []),
    adoptedByOptions: toOptions(facetBuckets.adoptedBy ?? []),
    contentStateOptions: toOptions(facetBuckets.contentState ?? []),
  };
}
