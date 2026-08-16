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

export interface DokumentaiSearchInput {
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
  metai?: string | string[];
  teismas?: string | string[];
  bylosRusis?: string | string[];
  kategorija?: string | string[];
  teisejas?: string | string[];
  aktoRusis?: string | string[];
  galiojimas?: string | string[];
  redakcija?: string | string[];
  projektoBusena?: string | string[];
  eurovoc?: string | string[];
  prieme?: string | string[];
  turinys?: string | string[];
  istaigosNr?: string | string[];
  regNr?: string | string[];
  nuo?: string;
  iki?: string;
  minLat?: string | number;
  maxLat?: string | number;
  minLon?: string | number;
  maxLon?: string | number;
  sort?: string;
  /** 'phrase' = tiksli frazė (kabutėse), 'words' (numatyta) = atskiri žodžiai. */
  mode?: string;
}

export interface FacetOption {
  value: string;
  count: number | null;
  /** Žmogui skirtas pavadinimas (pvz. istaigaJar kodui — įstaigos pavadinimas). */
  label?: string;
  /** Nepilnas BVPŽ kodas (prefiksinė paieška) — atvaizduojamas su „*" ženklu. */
  isPrefix?: boolean;
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
 * are milliseconds relative to the start of the request. */
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
  saltinioId0: string | null;
  saltinioId1: string | null;
  saltinioId2: string | null;
  saltinioId3: string | null;
  editionType: string | null;
  galiojimas: string | null;
  prieme: string | null;
  turinioBusena: string | null;
  istaigosNr: string | null;
  registracijosNr: string | null;
  title: string | null;
  snippet: string | null;
}

/** Geografinis stačiakampis (sritis), filtruojamas per Quickwit lat/lon range. */
export interface Bbox {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
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
  metaiFilter: string[];
  courtFilter: string[];
  caseTypeFilter: string[];
  categoryFilter: string[];
  judgeFilter: string[];
  actTypeFilter: string[];
  validityFilter: string[];
  editionTypeFilter: string[];
  projectStatusFilter: string[];
  eurovocFilter: string[];
  adoptedByFilter: string[];
  contentStateFilter: string[];
  institutionNumberFilter: string[];
  registrationNumberFilter: string[];
  dateFrom: string | null;
  dateTo: string | null;
  bbox: Bbox | null;
  typeCountMap: Record<string, number>;
  classCountMap: Record<string, number>;
  hostOptions: FacetOption[];
  jarOptions: FacetOption[];
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
  adoptedByOptions: FacetOption[];
  contentStateOptions: FacetOption[];
}
