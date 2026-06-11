import { postgres } from '@/postgres/postgres.js';
import { search, getDeadRatio } from '@/quickwit/quickwit.js';
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
  /** paskelbusios įstaigos JAR kodas (istaigaJar) */
  istaiga?: string[];
  ext?: string[];
  md5?: string;
  language?: string;
}

export interface FacetOption {
  value: string;
  count: number | null;
  /** Žmogui skirtas pavadinimas (pvz. istaigaJar kodui — įstaigos pavadinimas). */
  label?: string;
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
  class: string | null;
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
  istaigaPavadinimas: string | null;
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
  classFilter: string[];
  typeFilter: string[];
  hostFilter: string[];
  jarFilter: string[];
  istaigaJarFilter: string[];
  extFilter: string[];
  authorFilter: string[];
  creatorFilter: string[];
  producerFilter: string[];
  langFilter: string[];
  savFilter: string[];
  apskritisFilter: string[];
  sourceFilter: string[];
  courtFilter: string[];
  caseTypeFilter: string[];
  categoryFilter: string[];
  judgeFilter: string[];
  actTypeFilter: string[];
  validityFilter: string[];
  editionTypeFilter: string[];
  projectStatusFilter: string[];
  eurovocFilter: string[];
  bbox: Bbox | null;
  typeCountMap: Record<string, number>;
  classCountMap: Record<string, number>;
  hostOptions: FacetOption[];
  istaigaJarOptions: FacetOption[];
  extOptions: FacetOption[];
  authorOptions: FacetOption[];
  creatorOptions: FacetOption[];
  producerOptions: FacetOption[];
  langOptions: FacetOption[];
  savOptions: FacetOption[];
  apskritisOptions: FacetOption[];
  sourceOptions: FacetOption[];
  courtOptions: FacetOption[];
  caseTypeOptions: FacetOption[];
  categoryOptions: FacetOption[];
  judgeOptions: FacetOption[];
  actTypeOptions: FacetOption[];
  validityOptions: FacetOption[];
  editionTypeOptions: FacetOption[];
  projectStatusOptions: FacetOption[];
  eurovocOptions: FacetOption[];
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

/** Papildo istaigaJar facetus įstaigų pavadinimais iš jar lentelės (žmogui
 *  pavadinimas svarbiausias; JAR kodas lieka kaip antrinė eilutė + filtravimo
 *  reikšmė). Nerasti kodai lieka be label. */
async function attachIstaigaNames(options: FacetOption[]): Promise<FacetOption[]> {
  const codes = [...new Set(options.map((o) => o.value).filter(Boolean))];
  if (!codes.length) return options;
  const { rows } = await postgres.query(
    `SELECT "jarKodas", pavadinimas FROM public.jar WHERE "jarKodas" = ANY($1)`,
    [codes],
  );
  const names = new Map<string, string>(
    rows.filter((r: any) => r.pavadinimas).map((r: any) => [String(r.jarKodas), String(r.pavadinimas)]),
  );
  return options.map((o) => ({ ...o, label: names.get(o.value) }));
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
  const classes: string[] = [];
  const types: string[] = [];
  const hosts: string[] = [];
  const jars: string[] = [];
  const exts: string[] = [];

  textQuery = textQuery.replace(/\b(?:class|klase|klasė|sritis):(\S+)/gi, (_, v) => { classes.push(v); return ''; });
  textQuery = textQuery.replace(/\b(?:type|tipas):(\S+)/gi, (_, v) => { types.push(v); return ''; });
  textQuery = textQuery.replace(/\b(?:host|site|puslapis):(\S+)/gi, (_, v) => { hosts.push(v); return ''; });
  textQuery = textQuery.replace(/\b(?:jar|juridiniai|jarkodas):(\S+)/gi, (_, v) => { jars.push(v); return ''; });
  textQuery = textQuery.replace(/\b(?:extension|plėtinys|pletinys|ext):\.?(\S+)/gi, (_, v) => {
    exts.push(v.toLowerCase());
    return '';
  });

  return { textQuery: textQuery.trim(), classes, types, hosts, jars, exts };
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
  classes: string[];
  types: string[];
  hosts: string[];
  jars: string[];
  istaigos: string[];
  exts: string[];
  authors: string[];
  creators: string[];
  producers: string[];
  langs: string[];
  savs: string[];
  apskritys: string[];
  sources: string[];
  courts: string[];
  caseTypes: string[];
  categories: string[];
  judges: string[];
  actTypes: string[];
  validities: string[];
  editionTypes: string[];
  projectStatuses: string[];
  eurovoc: string[];
  bbox?: Bbox | null;
  excludeClass?: boolean;
  excludeHost?: boolean;
  excludeJar?: boolean;
  excludeIstaiga?: boolean;
  excludeExt?: boolean;
  excludeAuthor?: boolean;
  excludeCreator?: boolean;
  excludeProducer?: boolean;
  excludeType?: boolean;
  excludeLang?: boolean;
  excludeSav?: boolean;
  excludeApskritis?: boolean;
  excludeSource?: boolean;
  excludeCourt?: boolean;
  excludeCaseType?: boolean;
  excludeCategory?: boolean;
  excludeJudge?: boolean;
  excludeActType?: boolean;
  excludeValidity?: boolean;
  excludeEditionType?: boolean;
  excludeProjectStatus?: boolean;
  excludeEurovoc?: boolean;
  /** Tiksli frazė: tekstą paduodam Quickwit'ui kabutėse ("…"), kad žodžiai būtų
   *  randami tiksliai greta ir ta pačia tvarka, o ne kaip atskiri terminai. */
  phrase?: boolean;
}): string {
  const { textQuery, classes, types, hosts, jars, istaigos, exts, authors, creators, producers, langs, savs, apskritys, sources, courts, caseTypes, categories, judges, actTypes, validities, editionTypes, projectStatuses, eurovoc, bbox } = opts;
  const p: string[] = [];
  if (!opts.excludeClass && classes.length) p.push(`(${classes.map((c) => `class:${JSON.stringify(c)}`).join(' OR ')})`);
  if (!opts.excludeType && types.length) p.push(`(${types.map((t) => `type:${t}`).join(' OR ')})`);
  // Teismo nuosprendžių metadata filtrai (metadata.* yra json/raw — tiksli atitiktis).
  if (!opts.excludeCourt && courts.length) p.push(`(${courts.map((v) => `metadata.teismas:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeCaseType && caseTypes.length) p.push(`(${caseTypes.map((v) => `metadata.bylosRusis:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeCategory && categories.length) p.push(`(${categories.map((v) => `metadata.kategorijos:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeJudge && judges.length) p.push(`(${judges.map((v) => `metadata.teisejai:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeActType && actTypes.length) p.push(`(${actTypes.map((v) => `metadata.rusis:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeValidity && validities.length) p.push(`(${validities.map((v) => `metadata.galiojimas:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeEditionType && editionTypes.length) p.push(`(${editionTypes.map((v) => `metadata.editionType:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeProjectStatus && projectStatuses.length) p.push(`(${projectStatuses.map((v) => `metadata.busena:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeEurovoc && eurovoc.length) p.push(`(${eurovoc.map((v) => `metadata.eurovocTerminai:${JSON.stringify(v)}`).join(' OR ')})`);
  if (!opts.excludeHost && hosts.length) p.push(`(${hosts.map((h) => `host:${JSON.stringify(h)}`).join(' OR ')})`);
  if (!opts.excludeJar && jars.length) {
    const numeric = jars.map((j) => parseInt(j, 10)).filter((n) => Number.isFinite(n));
    if (numeric.length) p.push(`(${numeric.map((n) => `jarKodai:${n}`).join(' OR ')})`);
  }
  // Paskelbusi įstaiga: tiksli atitiktis pagal istaigaJar (raw tokenizer).
  if (!opts.excludeIstaiga && istaigos.length) p.push(`(${istaigos.map((v) => `istaigaJar:${JSON.stringify(v)}`).join(' OR ')})`);
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
  // A lone `*` means "match everything" in both modes — add no text constraint
  // (so it ANDs cleanly with any active filters, or falls through to the `*`
  // default below). Without this it would be sent as `"*"`/`(*)` and Quickwit
  // would look for a literal asterisk and match nothing.
  if (textQuery && textQuery !== '*') {
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
  klase?: string | string[];
  type?: string | string[];
  host?: string | string[];
  jar?: string | string[];
  istaiga?: string | string[];
  ext?: string | string[];
  author?: string | string[];
  creator?: string | string[];
  producer?: string | string[];
  lang?: string | string[];
  sav?: string | string[];
  apskritis?: string | string[];
  source?: string | string[];
  teismas?: string | string[];
  bylosRusis?: string | string[];
  kategorija?: string | string[];
  teisejas?: string | string[];
  aktoRusis?: string | string[];
  galiojimas?: string | string[];
  redakcija?: string | string[];
  projektoBusena?: string | string[];
  eurovoc?: string | string[];
  minLat?: string | number;
  maxLat?: string | number;
  minLon?: string | number;
  maxLon?: string | number;
  mode?: string;
}) {
  const rawQ = (input.q ?? '').trim();
  const phrase = input.mode === 'phrase';

  const classFilter = splitMulti(input.klase);
  const typeFilter = splitMulti(input.type);
  const hostFilter = splitMulti(input.host);
  const jarFilter = splitMulti(input.jar);
  const istaigaFilter = splitMulti(input.istaiga);
  const extFilter = splitMulti(input.ext).map((e) => e.toLowerCase().replace(/^\./, ''));
  const authorFilter = Array.isArray(input.author) ? input.author.filter(Boolean) : input.author ? [input.author] : [];
  const creatorFilter = Array.isArray(input.creator) ? input.creator.filter(Boolean) : input.creator ? [input.creator] : [];
  const producerFilter = Array.isArray(input.producer) ? input.producer.filter(Boolean) : input.producer ? [input.producer] : [];
  const langFilter = splitMulti(input.lang);
  const savFilter = splitMulti(input.sav);
  const apskritisFilter = splitMulti(input.apskritis);
  const sourceFilter = splitMulti(input.source).map(canonSource);
  // Nuosprendžių metadata filtrai gali turėti kablelių vardo viduje (pvz. kategorijų
  // pavadinimai), todėl jų NEskaidom per kablelį — imam kaip atskiras reikšmes.
  const courtFilter = Array.isArray(input.teismas) ? input.teismas.filter(Boolean) : input.teismas ? [input.teismas] : [];
  const caseTypeFilter = Array.isArray(input.bylosRusis) ? input.bylosRusis.filter(Boolean) : input.bylosRusis ? [input.bylosRusis] : [];
  const categoryFilter = Array.isArray(input.kategorija) ? input.kategorija.filter(Boolean) : input.kategorija ? [input.kategorija] : [];
  const judgeFilter = Array.isArray(input.teisejas) ? input.teisejas.filter(Boolean) : input.teisejas ? [input.teisejas] : [];
  const actTypeFilter = Array.isArray(input.aktoRusis) ? input.aktoRusis.filter(Boolean) : input.aktoRusis ? [input.aktoRusis] : [];
  const validityFilter = Array.isArray(input.galiojimas) ? input.galiojimas.filter(Boolean) : input.galiojimas ? [input.galiojimas] : [];
  const editionTypeFilter = Array.isArray(input.redakcija) ? input.redakcija.filter(Boolean) : input.redakcija ? [input.redakcija] : [];
  const projectStatusFilter = Array.isArray(input.projektoBusena) ? input.projektoBusena.filter(Boolean) : input.projektoBusena ? [input.projektoBusena] : [];
  const eurovocFilter = Array.isArray(input.eurovoc) ? input.eurovoc.filter(Boolean) : input.eurovoc ? [input.eurovoc] : [];

  const { textQuery, classes: inlineClasses, types: inlineTypes, hosts: inlineHosts, jars: inlineJars, exts: inlineExts } =
    extractInlineTokens(rawQ);

  return {
    textQuery,
    classes: [...new Set([...inlineClasses, ...classFilter])],
    types: [...new Set([...inlineTypes, ...typeFilter])],
    hosts: [...new Set([...inlineHosts, ...hostFilter])],
    jars: [...new Set([...inlineJars, ...jarFilter])],
    istaigos: [...new Set(istaigaFilter)],
    exts: [...new Set([...inlineExts, ...extFilter.map((e) => e.toLowerCase())])],
    authors: [...new Set(authorFilter)],
    creators: [...new Set(creatorFilter)],
    producers: [...new Set(producerFilter)],
    langs: [...new Set(langFilter)],
    savs: [...new Set(savFilter)],
    apskritys: [...new Set(apskritisFilter)],
    sources: [...new Set(sourceFilter)],
    courts: [...new Set(courtFilter)],
    caseTypes: [...new Set(caseTypeFilter)],
    categories: [...new Set(categoryFilter)],
    judges: [...new Set(judgeFilter)],
    actTypes: [...new Set(actTypeFilter)],
    validities: [...new Set(validityFilter)],
    editionTypes: [...new Set(editionTypeFilter)],
    projectStatuses: [...new Set(projectStatusFilter)],
    eurovoc: [...new Set(eurovocFilter)],
    bbox: parseBbox(input),
    phrase,
  };
}

// Quickwit field → the "exclude this facet's own filter" flag, so a facet lists
// every value available under the *other* active filters.
type FacetExcludeKey =
  | 'excludeClass' | 'excludeHost' | 'excludeIstaiga' | 'excludeExt' | 'excludeAuthor' | 'excludeCreator' | 'excludeProducer' | 'excludeLang'
  | 'excludeSav' | 'excludeApskritis' | 'excludeSource'
  | 'excludeCourt' | 'excludeCaseType' | 'excludeCategory' | 'excludeJudge'
  | 'excludeActType' | 'excludeValidity' | 'excludeEditionType' | 'excludeProjectStatus' | 'excludeEurovoc';
const FACET_EXCLUDE: Record<string, FacetExcludeKey> = {
  class: 'excludeClass',
  host: 'excludeHost',
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
  const options = buckets.filter((b) => b.value).map((b) => ({ value: b.value, count: b.count }));
  if (field === 'istaigaJar') return attachIstaigaNames(options);
  return options;
}

// ── Home overview (aggregations) ─────────────────────────────────────────────

/** One document-size metric (pages / words / characters) summarised by a
 *  Quickwit `percentiles` aggregation. Unlike a happenedAt timeline (sparse —
 *  many docs have no date), these numeric fast fields are populated on almost
 *  every document, so they portray the whole corpus honestly, long tail and all. */
export interface HomeSizeMetric {
  key: 'words' | 'pages' | 'chars';
  /** Short tab label, e.g. "Žodžiai". */
  label: string;
  /** Genitive unit for captions, e.g. "žodžių". */
  unit: string;
  /** p10…p99 breakpoints, ascending. */
  percentiles: { p: number; value: number }[];
  median: number;
  /** How many documents actually carry this field (denominator for honesty). */
  coverage: number;
}

/** Pre-aggregated portrait of the whole corpus, shown on the empty search home.
 *  Every block is a Quickwit aggregation; the values double as one-click entry
 *  points into a filtered search. */
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

const EMPTY_OVERVIEW: DokumentaiHomeOverview = {
  total: 0, totalPages: 0, totalWords: 0,
  byType: [], byClass: [], bySource: [], byExt: [], topIstaiga: [], sizeMetrics: [],
};

export async function dokumentaiHomeOverview(): Promise<DokumentaiHomeOverview> {
  if (homeOverviewCache && Date.now() - homeOverviewCache.at < HOME_OVERVIEW_TTL_MS) {
    return homeOverviewCache.data;
  }
  try {
    // Quickwit counts (num_hits, sums, facet doc_counts) include tombstones, so
    // they overstate the live corpus. Scale them by the live ratio (1 − dead),
    // the same correction search() applies to its result total.
    const [res, deadRatio] = await Promise.all([
      fetch(`${QW_URL}/api/v1/${LENTELE}_*/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '*',
        max_hits: 0,
        aggs: {
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
        },
        format: 'json',
      }),
      }),
      getDeadRatio(LENTELE).catch(() => 0),
    ]);
    if (!res.ok) return EMPTY_OVERVIEW;
    const data: any = await res.json();
    const aggs = data?.aggregations ?? {};

    const liveRatio = Math.max(0.01, 1 - Number(deadRatio || 0));
    const scaleCount = (n: number) => Math.round(n * liveRatio);

    const termOptions = (key: string): FacetOption[] =>
      (aggs[key]?.buckets ?? [])
        .filter((b: any) => b.key !== '' && b.key != null)
        .map((b: any) => ({ value: String(b.key), count: scaleCount(Number(b.doc_count)) }));

    // Merge inconsistently-cased source buckets (cvpIs / cvpis …), like the sidebar.
    const sourceCounts = new Map<string, number>();
    for (const b of aggs.bySource?.buckets ?? []) {
      if (!b.key) continue;
      const k = canonSource(String(b.key));
      sourceCounts.set(k, (sourceCounts.get(k) ?? 0) + Number(b.doc_count));
    }
    const bySource: FacetOption[] = [...sourceCounts.entries()]
      .map(([value, count]) => ({ value, count: scaleCount(count) }))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));

    // Build one size metric from its percentiles + value_count aggregations.
    // Quickwit returns percentile keys as stringified floats ("50.0"). Skip a
    // metric whose distribution is degenerate (no spread between p10 and p99).
    const buildMetric = (
      key: HomeSizeMetric['key'], label: string, unit: string, pctAgg: any, cntAgg: any,
    ): HomeSizeMetric | null => {
      const pv: Record<string, any> = pctAgg?.values ?? {};
      const percentiles = SIZE_PERCENTILES
        .map((p) => ({ p, value: Math.round(Number(pv[`${p}.0`] ?? pv[p])) }))
        .filter((x) => Number.isFinite(x.value) && x.value >= 0);
      if (percentiles.length <= 1) return null;
      if (percentiles[0].value === percentiles[percentiles.length - 1].value) return null;
      const median = percentiles.find((x) => x.p === 50)?.value ?? 0;
      return { key, label, unit, percentiles, median, coverage: Math.round(Number(cntAgg?.value ?? 0)) };
    };
    const sizeMetrics = [
      buildMetric('words', 'Žodžiai', 'žodžių', aggs.wordsPct, aggs.wordsCnt),
      buildMetric('pages', 'Puslapiai', 'puslapių', aggs.pagesPct, aggs.pagesCnt),
      buildMetric('chars', 'Simboliai', 'simbolių', aggs.charsPct, aggs.charsCnt),
    ].filter((m): m is HomeSizeMetric => m !== null);

    const data_: DokumentaiHomeOverview = {
      total: scaleCount(Number(data?.num_hits ?? 0)),
      totalPages: scaleCount(Number(aggs.pages?.value ?? 0)),
      totalWords: scaleCount(Number(aggs.words?.value ?? 0)),
      byType: termOptions('byType'),
      byClass: termOptions('byClass'),
      bySource,
      byExt: termOptions('byExt'),
      topIstaiga: await attachIstaigaNames(termOptions('byIstaiga')),
      sizeMetrics,
    };
    homeOverviewCache = { at: Date.now(), data: data_ };
    return data_;
  } catch {
    return EMPTY_OVERVIEW;
  }
}

// ── Snippets ─────────────────────────────────────────────────────────────────

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

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

// ── Public API ───────────────────────────────────────────────────────────────

export async function searchDokumentai(input: {
  q?: string;
  page?: number;
  klase?: string | string[];
  type?: string | string[];
  host?: string | string[];
  jar?: string | string[];
  istaiga?: string | string[];
  ext?: string | string[];
  author?: string | string[];
  creator?: string | string[];
  producer?: string | string[];
  lang?: string | string[];
  sav?: string | string[];
  apskritis?: string | string[];
  source?: string | string[];
  teismas?: string | string[];
  bylosRusis?: string | string[];
  kategorija?: string | string[];
  teisejas?: string | string[];
  aktoRusis?: string | string[];
  galiojimas?: string | string[];
  redakcija?: string | string[];
  projektoBusena?: string | string[];
  eurovoc?: string | string[];
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
  let sortBy = DOKUMENTAI_SORT_MAP.get(sort)!;

  const partsOpts = buildPartsOpts(input);
  const { textQuery } = partsOpts;

  // Without query terms (a bare `*` or filter-only browse), `_score` is the same
  // for every document, so Quickwit returns them in an arbitrary, unstable order.
  // After the tombstone filter that can leave a page with too few — sometimes
  // zero — live hits, and it makes the result set flicker between requests. Fall
  // back to a stable, always-present field (`id`, newest first) so browsing is
  // deterministic and start_offset paging stays consistent.
  const noTextTerms = !textQuery || textQuery === '*';
  if (sort === 'relevance' && noTextTerms) sortBy = 'id';

  const qwQuery = buildPartsExcluding(partsOpts);
  const classFacetQuery = buildPartsExcluding({ ...partsOpts, excludeClass: true });
  const hostFacetQuery = buildPartsExcluding({ ...partsOpts, excludeHost: true });
  const istaigaFacetQuery = buildPartsExcluding({ ...partsOpts, excludeIstaiga: true });
  const typeFacetQuery = buildPartsExcluding(partsOpts);
  const extFacetQuery = buildPartsExcluding({ ...partsOpts, excludeExt: true });
  const authorFacetQuery = buildPartsExcluding({ ...partsOpts, excludeAuthor: true });
  const creatorFacetQuery = buildPartsExcluding({ ...partsOpts, excludeCreator: true });
  const producerFacetQuery = buildPartsExcluding({ ...partsOpts, excludeProducer: true });
  const langFacetQuery = buildPartsExcluding({ ...partsOpts, excludeLang: true });
  const savFacetQuery = buildPartsExcluding({ ...partsOpts, excludeSav: true });
  const apskritisFacetQuery = buildPartsExcluding({ ...partsOpts, excludeApskritis: true });
  const sourceFacetQuery = buildPartsExcluding({ ...partsOpts, excludeSource: true });
  const courtFacetQuery = buildPartsExcluding({ ...partsOpts, excludeCourt: true });
  const caseTypeFacetQuery = buildPartsExcluding({ ...partsOpts, excludeCaseType: true });
  const categoryFacetQuery = buildPartsExcluding({ ...partsOpts, excludeCategory: true });
  const judgeFacetQuery = buildPartsExcluding({ ...partsOpts, excludeJudge: true });
  const actTypeFacetQuery = buildPartsExcluding({ ...partsOpts, excludeActType: true });
  const validityFacetQuery = buildPartsExcluding({ ...partsOpts, excludeValidity: true });
  const editionTypeFacetQuery = buildPartsExcluding({ ...partsOpts, excludeEditionType: true });
  const projectStatusFacetQuery = buildPartsExcluding({ ...partsOpts, excludeProjectStatus: true });
  const eurovocFacetQuery = buildPartsExcluding({ ...partsOpts, excludeEurovoc: true });

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
    qwAggregate('class', classFacetQuery, 10),
    qwAggregate('metadata.teismas', courtFacetQuery, 60),
    qwAggregate('metadata.bylosRusis', caseTypeFacetQuery, 12),
    qwAggregate('metadata.kategorijos', categoryFacetQuery, 60),
    qwAggregate('metadata.teisejai', judgeFacetQuery, 60),
    qwAggregate('metadata.rusis', actTypeFacetQuery, 60),
    qwAggregate('metadata.galiojimas', validityFacetQuery, 20),
    qwAggregate('metadata.editionType', editionTypeFacetQuery, 10),
    qwAggregate('metadata.busena', projectStatusFacetQuery, 30),
    qwAggregate('metadata.eurovocTerminai', eurovocFacetQuery, 60),
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
    qwAggregate('istaigaJar', istaigaFacetQuery, 12),
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
  const [hostBuckets, typeBuckets, classBuckets, courtBuckets, caseTypeBuckets, categoryBuckets, judgeBuckets, actTypeBuckets, validityBuckets, editionTypeBuckets, projectStatusBuckets, eurovocBuckets, extBuckets, authorBuckets, creatorBuckets, producerBuckets, langBuckets, savBuckets, apskritisBuckets, sourceBuckets, istaigaBuckets] = await aggsPromise;
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
         d.id, d.md5, d."class", d.type, d.url, d.host, d.domain, d.source,
         d.pavadinimas, d.autorius,
         d.extension, d.language, d."pageCount", d."wordCount", d."characterCount",
         d.savivaldybe, d.apskritis, d."istaigaJar", j.pavadinimas AS "istaigaPavadinimas",
         d."happenedAt", d."createdAt", d."updatedAt", d."discoveredAt", d."failasId"
       FROM public.dokumentai d
       LEFT JOIN public.jar j ON j."jarKodas" = d."istaigaJar"
       WHERE d.id = ANY($1)`,
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

    // Snippets from sidecar JSON. With query terms we highlight them; without a
    // text query (filter-only browse) we still show a leading preview from the
    // start of the document so every card has context.
    const snippetQuery = textQuery && textQuery !== '*' ? textQuery : '';
    const snipStart = mark();
    await Promise.all(
      rows.map(async (row) => {
        if (!row.md5) return;
        try {
          const sidecar: any = await readDokumentasFs(row.md5);
          const text = normalizeDocText(sidecar?.text);
          if (text.length) {
            row.snippet = makeSnippet(text, snippetQuery, phrase ? 'phrase' : 'words');
          }
        } catch { /* sidecar miss is fine */ }
      }),
    );
    timings.push({ label: 'Ištraukos', phase: 'count', start: snipStart, duration: mark() - snipStart });
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
  const istaigaJarOptions = await attachIstaigaNames(toOptions(istaigaBuckets));
  const typeCountMap = Object.fromEntries(typeBuckets.map((b) => [b.value, b.count ?? 0]));
  const classCountMap = Object.fromEntries(classBuckets.map((b) => [b.value, b.count ?? 0]));
  const courtOptions = toOptions(courtBuckets);
  const caseTypeOptions = toOptions(caseTypeBuckets);
  const categoryOptions = toOptions(categoryBuckets);
  const judgeOptions = toOptions(judgeBuckets);
  const actTypeOptions = toOptions(actTypeBuckets);
  const validityOptions = toOptions(validityBuckets);
  const editionTypeOptions = toOptions(editionTypeBuckets);
  const projectStatusOptions = toOptions(projectStatusBuckets);
  const eurovocOptions = toOptions(eurovocBuckets);
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
    classFilter: partsOpts.classes,
    typeFilter: partsOpts.types,
    hostFilter: partsOpts.hosts,
    jarFilter: partsOpts.jars,
    istaigaJarFilter: partsOpts.istaigos,
    extFilter: partsOpts.exts,
    authorFilter: partsOpts.authors,
    creatorFilter: partsOpts.creators,
    producerFilter: partsOpts.producers,
    langFilter: partsOpts.langs,
    savFilter: partsOpts.savs,
    apskritisFilter: partsOpts.apskritys,
    sourceFilter: partsOpts.sources,
    courtFilter: partsOpts.courts,
    caseTypeFilter: partsOpts.caseTypes,
    categoryFilter: partsOpts.categories,
    judgeFilter: partsOpts.judges,
    actTypeFilter: partsOpts.actTypes,
    validityFilter: partsOpts.validities,
    editionTypeFilter: partsOpts.editionTypes,
    projectStatusFilter: partsOpts.projectStatuses,
    eurovocFilter: partsOpts.eurovoc,
    bbox: partsOpts.bbox,
    typeCountMap,
    classCountMap,
    hostOptions,
    istaigaJarOptions,
    extOptions,
    authorOptions,
    creatorOptions,
    producerOptions,
    langOptions,
    savOptions,
    apskritisOptions,
    sourceOptions,
    courtOptions,
    caseTypeOptions,
    categoryOptions,
    judgeOptions,
    actTypeOptions,
    validityOptions,
    editionTypeOptions,
    projectStatusOptions,
    eurovocOptions,
  };
}
