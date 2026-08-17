import { qwUserText } from '@/quickwit/qwUserText.js';
import { foldLithuanian } from '../snippet.ts';
import type { Bbox, DokumentaiSearchInput } from './types.ts';

const SOURCE_CANONICAL: Record<string, string> = {
  cvpis: 'cvpIs',
  mvpaprasai: 'mvpAprasai',
  neskelbiamosderybos: 'neskelbiamosDerybos',
};

export const canonSource = (value: string): string =>
  SOURCE_CANONICAL[value.toLowerCase()] ?? value;

function splitMulti(raw: string | string[] | undefined): string[] {
  if (raw == null) return [];
  const joined = Array.isArray(raw) ? raw.join(',') : raw;
  return joined.split(',').map((value) => value.trim()).filter(Boolean);
}

/** Pull supported filter tokens out of the free-text query. */
export function extractInlineTokens(q: string) {
  let textQuery = q;
  const classes: string[] = [];
  const types: string[] = [];
  const hosts: string[] = [];
  const jars: string[] = [];
  const exts: string[] = [];

  textQuery = textQuery.replace(/\b(?:class|klase|klasė|sritis):(\S+)/gi, (_, value) => { classes.push(value); return ''; });
  textQuery = textQuery.replace(/\b(?:type|tipas):(\S+)/gi, (_, value) => { types.push(value); return ''; });
  textQuery = textQuery.replace(/\b(?:host|site|puslapis):(\S+)/gi, (_, value) => { hosts.push(value); return ''; });
  textQuery = textQuery.replace(/\b(?:jar|juridiniai|jarkodas):(\S+)/gi, (_, value) => { jars.push(value); return ''; });
  textQuery = textQuery.replace(/\b(?:extension|plėtinys|pletinys|ext):\.?(\S+)/gi, (_, value) => {
    exts.push(value.toLowerCase());
    return '';
  });

  return { textQuery: textQuery.trim(), classes, types, hosts, jars, exts };
}

type FacetKind = 'term' | 'jar' | 'years';
interface FacetDef {
  key: string;
  param: string;
  field: string;
  exclude: string;
  kind: FacetKind;
  quote: boolean;
  parse: 'split' | 'array';
  inline?: 'classes' | 'types' | 'hosts' | 'jars' | 'exts';
  transform?: (value: string) => string;
}

const FACETS = [
  { key: 'classes', param: 'klase', field: 'class', exclude: 'excludeClass', kind: 'term', quote: true, parse: 'split', inline: 'classes' },
  { key: 'types', param: 'type', field: 'type', exclude: 'excludeType', kind: 'term', quote: false, parse: 'split', inline: 'types' },
  { key: 'courts', param: 'teismas', field: 'metadata.teismas', exclude: 'excludeCourt', kind: 'term', quote: true, parse: 'array' },
  { key: 'caseTypes', param: 'bylosRusis', field: 'metadata.bylosRusis', exclude: 'excludeCaseType', kind: 'term', quote: true, parse: 'array' },
  { key: 'categories', param: 'kategorija', field: 'metadata.kategorijos', exclude: 'excludeCategory', kind: 'term', quote: true, parse: 'array' },
  { key: 'judges', param: 'teisejas', field: 'metadata.teisejai', exclude: 'excludeJudge', kind: 'term', quote: true, parse: 'array' },
  { key: 'actTypes', param: 'aktoRusis', field: 'metadata.rusis', exclude: 'excludeActType', kind: 'term', quote: true, parse: 'array' },
  { key: 'validities', param: 'galiojimas', field: 'metadata.galiojimas', exclude: 'excludeValidity', kind: 'term', quote: true, parse: 'array' },
  { key: 'editionTypes', param: 'redakcija', field: 'metadata.editionType', exclude: 'excludeEditionType', kind: 'term', quote: true, parse: 'array' },
  { key: 'projectStatuses', param: 'projektoBusena', field: 'metadata.busena', exclude: 'excludeProjectStatus', kind: 'term', quote: true, parse: 'array' },
  { key: 'eurovoc', param: 'eurovoc', field: 'metadata.eurovocTerminai', exclude: 'excludeEurovoc', kind: 'term', quote: true, parse: 'array' },
  { key: 'adoptedBy', param: 'prieme', field: 'metadata.prieme', exclude: 'excludeAdoptedBy', kind: 'term', quote: true, parse: 'array' },
  { key: 'contentStates', param: 'turinys', field: 'metadata.turinioBusena', exclude: 'excludeContentState', kind: 'term', quote: true, parse: 'array' },
  { key: 'institutionNumbers', param: 'istaigosNr', field: 'metadata.istaigosNr', exclude: 'excludeInstitutionNumber', kind: 'term', quote: true, parse: 'array' },
  { key: 'registrationNumbers', param: 'regNr', field: 'metadata.registracijosNr', exclude: 'excludeRegistrationNumber', kind: 'term', quote: true, parse: 'array' },
  { key: 'hosts', param: 'host', field: 'host', exclude: 'excludeHost', kind: 'term', quote: true, parse: 'split', inline: 'hosts' },
  { key: 'jars', param: 'jar', field: 'jarKodai', exclude: 'excludeJar', kind: 'jar', quote: false, parse: 'split', inline: 'jars' },
  { key: 'istaigos', param: 'istaiga', field: 'istaigaJar', exclude: 'excludeIstaiga', kind: 'term', quote: true, parse: 'split' },
  { key: 'exts', param: 'ext', field: 'extension', exclude: 'excludeExt', kind: 'term', quote: true, parse: 'split', inline: 'exts', transform: (value: string) => value.toLowerCase().replace(/^\./, '') },
  { key: 'authors', param: 'author', field: 'author', exclude: 'excludeAuthor', kind: 'term', quote: true, parse: 'array' },
  { key: 'creators', param: 'creator', field: 'metadata.creator', exclude: 'excludeCreator', kind: 'term', quote: true, parse: 'array' },
  { key: 'producers', param: 'producer', field: 'metadata.producer', exclude: 'excludeProducer', kind: 'term', quote: true, parse: 'array' },
  { key: 'langs', param: 'lang', field: 'language', exclude: 'excludeLang', kind: 'term', quote: true, parse: 'split' },
  { key: 'savs', param: 'sav', field: 'savivaldybe', exclude: 'excludeSav', kind: 'term', quote: true, parse: 'split' },
  { key: 'apskritys', param: 'apskritis', field: 'apskritis', exclude: 'excludeApskritis', kind: 'term', quote: true, parse: 'split' },
  { key: 'sources', param: 'source', field: 'source', exclude: 'excludeSource', kind: 'term', quote: true, parse: 'split', transform: canonSource },
  { key: 'years', param: 'metai', field: 'happenedAt', exclude: 'excludeMetai', kind: 'years', quote: false, parse: 'split' },
] as const;

export type FacetKey = typeof FACETS[number]['key'];
export type ExcludeKey = typeof FACETS[number]['exclude'];
export type ParsedParts = {
  textQuery: string;
  bbox: Bbox | null;
  dateFrom: string | null;
  dateTo: string | null;
  phrase: boolean;
} & Record<FacetKey, string[]>;

const asArray = (value: string | string[] | undefined): string[] =>
  Array.isArray(value) ? value.filter(Boolean) : value ? [value] : [];

export function buildPartsExcluding(
  opts: ParsedParts & Partial<Record<ExcludeKey, boolean>>,
): string {
  const { textQuery, bbox } = opts;
  const parts: string[] = [];
  for (const facet of FACETS as readonly FacetDef[]) {
    if ((opts as Record<string, unknown>)[facet.exclude]) continue;
    const values = opts[facet.key as FacetKey];
    if (!values?.length) continue;
    if (facet.kind === 'term') {
      parts.push(`(${values.map((value) => `${facet.field}:${facet.quote ? JSON.stringify(value) : value}`).join(' OR ')})`);
    } else if (facet.kind === 'jar') {
      const numeric = values.map((value) => parseInt(value, 10)).filter(Number.isFinite);
      if (numeric.length) parts.push(`(${numeric.map((value) => `${facet.field}:${value}`).join(' OR ')})`);
    } else {
      const years = values.map((value) => parseInt(value, 10)).filter(Number.isFinite);
      if (years.length) parts.push(`(${years.map((year) => `${facet.field}:[${year}-01-01T00:00:00Z TO ${year + 1}-01-01T00:00:00Z}`).join(' OR ')})`);
    }
  }
  if (opts.dateFrom || opts.dateTo) {
    const nextDay = (date: string) => {
      const value = new Date(`${date}T00:00:00Z`);
      value.setUTCDate(value.getUTCDate() + 1);
      return value.toISOString().slice(0, 10);
    };
    const from = opts.dateFrom ? `${opts.dateFrom}T00:00:00Z` : '*';
    const to = opts.dateTo ? `${nextDay(opts.dateTo)}T00:00:00Z` : '*';
    parts.push(`happenedAt:[${from} TO ${to}}`);
  }
  if (bbox) {
    parts.push(`lat:[${bbox.minLat} TO ${bbox.maxLat}]`);
    parts.push(`lon:[${bbox.minLon} TO ${bbox.maxLon}]`);
  }
  if (textQuery && textQuery !== '*') {
    const terms = qwUserText(foldLithuanian(textQuery), { phrase: opts.phrase });
    if (terms) parts.push(opts.phrase ? terms : `(${terms})`);
  }
  return parts.join(' AND ') || '*';
}

function parseBbox(input: DokumentaiSearchInput): Bbox | null {
  const numberOrNull = (value: string | number | undefined) => {
    const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? parsed : null;
  };
  const minLat = numberOrNull(input.minLat), maxLat = numberOrNull(input.maxLat);
  const minLon = numberOrNull(input.minLon), maxLon = numberOrNull(input.maxLon);
  if (minLat == null || maxLat == null || minLon == null || maxLon == null) return null;
  return {
    minLat: Math.min(minLat, maxLat),
    maxLat: Math.max(minLat, maxLat),
    minLon: Math.min(minLon, maxLon),
    maxLon: Math.max(minLon, maxLon),
  };
}

export function buildPartsOpts(input: DokumentaiSearchInput): ParsedParts {
  const rawQuery = (input.q ?? '').trim();
  const inline = extractInlineTokens(rawQuery);
  const source = input as Record<string, string | string[] | undefined>;
  const parsed: Record<string, unknown> = {
    textQuery: inline.textQuery,
    bbox: parseBbox(input),
    phrase: input.mode === 'phrase',
  };
  const validDate = (value: unknown) => {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : null;
  };
  let dateFrom = validDate(input.nuo);
  let dateTo = validDate(input.iki);
  if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  parsed.dateFrom = dateFrom;
  parsed.dateTo = dateTo;
  for (const facet of FACETS as readonly FacetDef[]) {
    let values = facet.parse === 'split' ? splitMulti(source[facet.param]) : asArray(source[facet.param]);
    if (facet.transform) values = values.map(facet.transform);
    if (facet.inline) values = [...((inline as unknown as Record<string, string[]>)[facet.inline] ?? []), ...values];
    parsed[facet.key] = [...new Set(values)];
  }
  return parsed as ParsedParts;
}
