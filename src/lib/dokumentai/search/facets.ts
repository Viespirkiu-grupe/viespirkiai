import { postgres } from '@/postgres/postgres.js';
import { buildPartsExcluding, buildPartsOpts, type ExcludeKey, type ParsedParts } from './query.ts';
import { mergeSourceBuckets, qwAggregate } from './quickwitAggregations.ts';
import type { DokumentaiSearchInput, FacetOption } from './types.ts';

/** Add human-readable institution names to JAR-code facet options. */
export async function attachIstaigaNames(options: FacetOption[]): Promise<FacetOption[]> {
  const codes = [...new Set(options.map((option) => option.value).filter(Boolean))];
  if (!codes.length) return options;
  const { rows } = await postgres.query(
    `SELECT "jarKodas", pavadinimas FROM "rcJar"."spintaAsmenys" WHERE "jarKodas" = ANY($1)`,
    [codes],
  );
  const names = new Map<string, string>(
    rows
      .filter((row: any) => row.pavadinimas)
      .map((row: any) => [String(row.jarKodas), String(row.pavadinimas)]),
  );
  return options.map((option) => ({ ...option, label: names.get(option.value) }));
}

type FacetExcludeKey = Exclude<ExcludeKey, 'excludeType' | 'excludeMetai'>;
const FACET_EXCLUDE: Record<string, FacetExcludeKey> = {
  class: 'excludeClass',
  host: 'excludeHost',
  jarKodai: 'excludeJar',
  istaigaJar: 'excludeIstaiga',
  extension: 'excludeExt',
  author: 'excludeAuthor',
  'metadata.creator': 'excludeCreator',
  'metadata.producer': 'excludeProducer',
  language: 'excludeLang',
  savivaldybe: 'excludeSav',
  apskritis: 'excludeApskritis',
  source: 'excludeSource',
  'metadata.teismas': 'excludeCourt',
  'metadata.bylosRusis': 'excludeCaseType',
  'metadata.kategorijos': 'excludeCategory',
  'metadata.teisejai': 'excludeJudge',
  'metadata.rusis': 'excludeActType',
  'metadata.galiojimas': 'excludeValidity',
  'metadata.editionType': 'excludeEditionType',
  'metadata.busena': 'excludeProjectStatus',
  'metadata.eurovocTerminai': 'excludeEurovoc',
  'metadata.prieme': 'excludeAdoptedBy',
  'metadata.turinioBusena': 'excludeContentState',
  'metadata.istaigosNr': 'excludeInstitutionNumber',
  'metadata.registracijosNr': 'excludeRegistrationNumber',
};

export async function dokumentaiFacetOptions(
  field: string,
  input: DokumentaiSearchInput,
  size = 1000,
): Promise<FacetOption[]> {
  const excludeKey = FACET_EXCLUDE[field];
  if (!excludeKey) return [];
  const parts = buildPartsOpts(input);
  const query = buildPartsExcluding({ ...parts, [excludeKey]: true });
  const buckets = await qwAggregate(field, query, size);
  const options = toOptions(buckets);
  if (field === 'jarKodai' || field === 'istaigaJar') return attachIstaigaNames(options);
  return options;
}

interface SearchFacetDefinition {
  key: string;
  field: string;
  size: number;
  exclude?: ExcludeKey;
}

/** Sidebar facets. `type` intentionally keeps its own filter for compatibility. */
const SEARCH_FACETS: readonly SearchFacetDefinition[] = [
  { key: 'host', field: 'host', size: 15, exclude: 'excludeHost' },
  { key: 'jar', field: 'jarKodai', size: 7, exclude: 'excludeJar' },
  { key: 'type', field: 'type', size: 10 },
  { key: 'class', field: 'class', size: 10, exclude: 'excludeClass' },
  { key: 'court', field: 'metadata.teismas', size: 60, exclude: 'excludeCourt' },
  { key: 'caseType', field: 'metadata.bylosRusis', size: 12, exclude: 'excludeCaseType' },
  { key: 'category', field: 'metadata.kategorijos', size: 60, exclude: 'excludeCategory' },
  { key: 'judge', field: 'metadata.teisejai', size: 60, exclude: 'excludeJudge' },
  { key: 'actType', field: 'metadata.rusis', size: 60, exclude: 'excludeActType' },
  { key: 'validity', field: 'metadata.galiojimas', size: 20, exclude: 'excludeValidity' },
  { key: 'editionType', field: 'metadata.editionType', size: 10, exclude: 'excludeEditionType' },
  { key: 'projectStatus', field: 'metadata.busena', size: 30, exclude: 'excludeProjectStatus' },
  { key: 'eurovoc', field: 'metadata.eurovocTerminai', size: 60, exclude: 'excludeEurovoc' },
  { key: 'adoptedBy', field: 'metadata.prieme', size: 60, exclude: 'excludeAdoptedBy' },
  { key: 'contentState', field: 'metadata.turinioBusena', size: 20, exclude: 'excludeContentState' },
  { key: 'ext', field: 'extension', size: 7, exclude: 'excludeExt' },
  { key: 'author', field: 'author', size: 8, exclude: 'excludeAuthor' },
  { key: 'creator', field: 'metadata.creator', size: 8, exclude: 'excludeCreator' },
  { key: 'producer', field: 'metadata.producer', size: 8, exclude: 'excludeProducer' },
  { key: 'lang', field: 'language', size: 12, exclude: 'excludeLang' },
  { key: 'sav', field: 'savivaldybe', size: 60, exclude: 'excludeSav' },
  { key: 'apskritis', field: 'apskritis', size: 12, exclude: 'excludeApskritis' },
  { key: 'source', field: 'source', size: 12, exclude: 'excludeSource' },
  { key: 'istaiga', field: 'istaigaJar', size: 12, exclude: 'excludeIstaiga' },
];

export async function fetchSearchFacets(
  parts: ParsedParts,
): Promise<Record<string, FacetOption[]>> {
  const entries = await Promise.all(SEARCH_FACETS.map(async (facet) => {
    const query = facet.exclude
      ? buildPartsExcluding({ ...parts, [facet.exclude]: true })
      : buildPartsExcluding(parts);
    return [facet.key, await qwAggregate(facet.field, query, facet.size)] as const;
  }));
  return Object.fromEntries(entries);
}

export const toOptions = (buckets: FacetOption[]): FacetOption[] =>
  buckets.filter((bucket) => bucket.value).map((bucket) => ({
    value: bucket.value,
    count: bucket.count,
  }));

export function withSelected(options: FacetOption[], selected: string[]): FacetOption[] {
  const values = new Set(options.map((option) => option.value));
  return [
    ...selected.filter((value) => !values.has(value)).map((value) => ({ value, count: null })),
    ...options,
  ];
}

export { mergeSourceBuckets };
