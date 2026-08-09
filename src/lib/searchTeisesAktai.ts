// Quickwit paieška /teisesAktai puslapiui: užklausos surinkimas iš filtrų,
// facetų agregacijos ir hit'ų paruošimas atvaizdavimui.
//
// Indeksuojamas vienetas — DOKUMENTAS, ne aktas (originalas, galiojanti suvestinė
// ir kiekviena istorinė redakcija yra atskiri įrašai; juos jungia `legalActId`).
// Žr. modules/eTar/quickwitIndexConfig.yaml.
//
// Skirtingai nuo /dokumentai, hit'ų nehidratuojam iš Postgres: viskas, ko reikia
// kortelei, indekse jau `stored`. Iš šalies traukiam tik ištrauką — `tekstas`
// sąmoningai nesaugomas indekse, tad jis imamas iš SQLite sidecar'o pagal `md5`.
import { search } from '@/quickwit/quickwit.js';
import { QW_URL } from '@/quickwit/qwHttp.js';
import { qwUserText } from '@/quickwit/qwUserText.js';
import { openETarSidecar, readResponse } from '@/modules/eTar/eTarSidecar.js';
import { foldLithuanian, makeSnippet, normalizeDocText } from './dokumentai/snippet.ts';

const LENTELE = 'eTar';
const PAGE_SIZE = 10;
const PAGINATION_WINDOW = 8;
const NS_PER_MS = 1_000_000;
/**
 * Atsarginiai histogramos rėžiai, jei `priemimoData` min/max agregacija
 * nepavyktų — tikrieji imami iš indekso (žr. `indexYearBounds`).
 */
const FALLBACK_FIRST_YEAR = 1990;
/**
 * Kokią dalį rezultatų leidžiam nukirpti nuo senojo galo. e-TAR yra pavienių
 * XIX–XX a. aktų (1875, 1907, 1919…), dėl kurių slankiklio domenas nusidriektų
 * per šimtmetį beveik tuščių metų. Retesni už šią ribą metai iš domeno
 * išmetami, bet lieka pasiekiami įrašius datą ranka („nuo" laukas domeną
 * prasitęsia atgal).
 */
const HIST_TAIL_SHARE = 0.001;

export interface FacetOption {
  value: string;
  count: number | null;
  label?: string;
}

export interface Timing {
  label: string;
  phase: 'search' | 'pg' | 'filter' | 'count';
  start: number;
  duration: number;
}

export const TEISES_AKTAI_SORT_OPTIONS = [
  { value: 'relevance', label: 'Aktualumas', sortBy: '_score' },
  { value: 'newest', label: 'Naujausi', sortBy: 'priemimoData' },
  { value: 'oldest', label: 'Seniausi', sortBy: '-priemimoData' },
  { value: 'mostEditions', label: 'Daugiausia redakcijų', sortBy: 'redakcijuSkaicius' },
  { value: 'mostAttachments', label: 'Daugiausia priedų', sortBy: 'prieduSkaicius' },
] as const;

export type TeisesAktaiSort = typeof TEISES_AKTAI_SORT_OPTIONS[number]['value'];

const SORT_MAP = new Map<string, string>(
  TEISES_AKTAI_SORT_OPTIONS.map((option) => [option.value, option.sortBy]),
);

function resolveSort(raw: string | undefined): TeisesAktaiSort {
  return SORT_MAP.has(raw ?? '') ? raw as TeisesAktaiSort : 'relevance';
}

// Reikšmių pavadinimai gyvena atskirai (juos naudoja ir naršyklė) — čia tik
// pratęsiam eksportą, kad serverio pusė turėtų vieną importo tašką.
export {
  VARIANTAS_LABEL, TURINYS_LABEL, statusasLabel, eurovocLabel,
  variantasLabel, turinysLabel, LABEL_BY_PARAM,
} from './teisesAktaiLabels.ts';

export interface TeisesAktasHit {
  documentId: number;
  legalActId: string;
  variantas: string;
  redakcijosTokenas: string | null;
  md5: string | null;
  url: string | null;
  pavadinimas: string | null;
  aktoRusis: string | null;
  statusas: string | null;
  prieme: string | null;
  istaigosNr: string | null;
  registracijosNr: string | null;
  publikuota: string | null;
  eli: string | null;
  eurovoc: string[];
  priedai: string[];
  prieduSkaicius: number;
  redakcijuSkaicius: number;
  turinioBusena: string | null;
  priemimoData: string | null;
  registracijosData: string | null;
  isigaliojoNuo: string | null;
  galiojaIki: string | null;
  snippet: string | null;
}

export interface TeisesAktaiSearchResult {
  q: string;
  hits: TeisesAktasHit[];
  total: number;
  approximate: boolean;
  elapsed: string;
  engine: string;
  timings: Timing[];
  page: number;
  totalPages: number;
  pageNums: number[];
  sort: TeisesAktaiSort;
  rusisFilter: string[];
  statusasFilter: string[];
  variantasFilter: string[];
  priemeFilter: string[];
  eurovocFilter: string[];
  turinysFilter: string[];
  nuo: string | null;
  iki: string | null;
  istaigosNr: string | null;
  regNr: string | null;
  rusisOptions: FacetOption[];
  statusasOptions: FacetOption[];
  variantasOptions: FacetOption[];
  priemeOptions: FacetOption[];
  eurovocOptions: FacetOption[];
  turinysOptions: FacetOption[];
  dataHist: DataHistogram;
}

// ── Facetai ──────────────────────────────────────────────────────────────────

interface FacetDef {
  key: FacetKey;
  param: string;
  field: string;
  exclude: string;
  kind: 'term';
}

const FACETS = [
  { key: 'rusys', param: 'rusis', field: 'aktoRusis', exclude: 'excludeRusis', kind: 'term' },
  { key: 'statusai', param: 'statusas', field: 'statusas', exclude: 'excludeStatusas', kind: 'term' },
  { key: 'variantai', param: 'variantas', field: 'variantas', exclude: 'excludeVariantas', kind: 'term' },
  // `prieme` yra `default` tokenizeris + record: position, tad kabutės duoda
  // frazinę (tikslią) atitiktį, o ne atskirus žodžius.
  { key: 'prieme', param: 'prieme', field: 'prieme', exclude: 'excludePrieme', kind: 'term' },
  { key: 'eurovoc', param: 'eurovoc', field: 'eurovoc', exclude: 'excludeEurovoc', kind: 'term' },
  { key: 'turinys', param: 'turinys', field: 'turinioBusena', exclude: 'excludeTurinys', kind: 'term' },
] as const;

type FacetKey = 'rusys' | 'statusai' | 'variantai' | 'prieme' | 'eurovoc' | 'turinys';
type ExcludeKey = typeof FACETS[number]['exclude'] | 'excludeData';
type ParsedParts = {
  textQuery: string;
  phrase: boolean;
  /** Priėmimo datos rėžis „yyyy-mm-dd" (slankiklis), null = neribota. */
  nuo: string | null;
  iki: string | null;
  /** Tikslūs numeriai (`raw` tokenizeris) — įvedimo laukai, ne facetai. */
  istaigosNr: string | null;
  regNr: string | null;
} & Record<FacetKey, string[]>;

/** „yyyy-mm-dd" arba null — bet kas kita atmetama, kad nepatektų į užklausą. */
function isoDate(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** Numerių laukai: apkarpom, tuščią laikom nenurodytu. */
function trimmedOrNull(value: string | undefined): string | null {
  const v = (value ?? '').trim();
  return v || null;
}

const asArray = (x: string | string[] | undefined): string[] =>
  Array.isArray(x) ? x.filter(Boolean) : x ? [x] : [];

/** Kablelis skiria reikšmes tik ten, kur pačios reikšmės kablelių neturi. */
function splitMulti(raw: string | string[] | undefined): string[] {
  return asArray(raw).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
}

export function buildPartsOpts(input: {
  q?: string;
  rusis?: string | string[];
  statusas?: string | string[];
  variantas?: string | string[];
  prieme?: string | string[];
  eurovoc?: string | string[];
  turinys?: string | string[];
  nuo?: string;
  iki?: string;
  istaigosNr?: string;
  regNr?: string;
  mode?: string;
}): ParsedParts {
  return {
    textQuery: (input.q ?? '').trim(),
    phrase: input.mode === 'phrase',
    // Rūšys/būsenos/variantai kablelių neturi → skaidom.
    rusys: splitMulti(input.rusis),
    statusai: splitMulti(input.statusas),
    variantai: splitMulti(input.variantas),
    turinys: splitMulti(input.turinys),
    nuo: isoDate(input.nuo),
    iki: isoDate(input.iki),
    istaigosNr: trimmedOrNull(input.istaigosNr),
    regNr: trimmedOrNull(input.regNr),
    // Institucijų, EUROVOC terminų ir ryšių pavadinimuose kablelių pasitaiko →
    // imam kaip pasikartojančius parametrus, neskaidom.
    prieme: asArray(input.prieme),
    eurovoc: asArray(input.eurovoc),
  };
}

export function buildPartsExcluding(
  opts: ParsedParts & Partial<Record<ExcludeKey, boolean>>,
): string {
  const parts: string[] = [];

  for (const f of FACETS as readonly FacetDef[]) {
    if ((opts as Record<string, unknown>)[f.exclude]) continue;
    const values = opts[f.key];
    if (!values?.length) continue;

    parts.push(`(${values.map((v) => `${f.field}:${JSON.stringify(v)}`).join(' OR ')})`);
  }

  // Priėmimo datos rėžis. Abu galai inkliuzyvūs; „iki" imam iki dienos pabaigos,
  // kad pasirinkta data pati įeitų į rezultatą.
  if (!(opts as Record<string, unknown>).excludeData && (opts.nuo || opts.iki)) {
    const from = opts.nuo ? `${opts.nuo}T00:00:00Z` : '*';
    const to = opts.iki ? `${opts.iki}T23:59:59Z` : '*';
    parts.push(`priemimoData:[${from} TO ${to}]`);
  }

  // Numeriai indeksuoti `raw` tokenizeriu → tiksli visos reikšmės atitiktis.
  if (opts.istaigosNr) parts.push(`istaigosNr:${JSON.stringify(opts.istaigosNr)}`);
  if (opts.regNr) parts.push(`registracijosNr:${JSON.stringify(opts.regNr)}`);

  // Vienišas `*` reiškia „viskas" — jokio teksto apribojimo nepridedam.
  if (opts.textQuery && opts.textQuery !== '*') {
    // Indekse tekstas sulankstytas be diakritikų (foldLithuanian), tad ir
    // užklausą lankstom. qwUserText apsaugo nuo Quickwit užklausų kalbos simbolių.
    const terms = qwUserText(foldLithuanian(opts.textQuery), { phrase: opts.phrase });
    if (terms) parts.push(opts.phrase ? terms : `(${terms})`);
  }

  return parts.join(' AND ') || '*';
}

// ── Quickwit agregacijos ─────────────────────────────────────────────────────

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
    return (data?.aggregations?.values?.buckets ?? [])
      .map((b: any) => ({ value: String(b.key), count: Number(b.doc_count) }))
      .filter((o: FacetOption) => o.value);
  } catch {
    return [];
  }
}

export interface DataHistogram {
  buckets: { from: number; to: number; count: number }[];
  domainMin: number;
  domainMax: number;
}

/** Kai paieška nulūžta — slankiklis be stulpelių, bet su prasmingu domenu. */
export function emptyDataHistogram(): DataHistogram {
  return {
    buckets: [],
    domainMin: yearBoundsCache
      ? Date.UTC(yearBoundsCache.value.first, 0, 1)
      : Date.UTC(FALLBACK_FIRST_YEAR, 0, 1),
    domainMax: Date.now(),
  };
}

/**
 * Seniausi ir naujausi indekso `priemimoData` metai. Kinta tik perindeksavus,
 * tad užtenka kartą per valandą — histogramai jie reikalingi iš anksto, nes
 * `range` agregacijos rėžiai sudaromi prieš užklausą.
 */
let yearBoundsCache: { at: number; value: { first: number; last: number } } | null = null;
const YEAR_BOUNDS_TTL_MS = 3_600_000;

async function indexYearBounds(): Promise<{ first: number; last: number }> {
  const thisYear = new Date().getUTCFullYear();
  const fallback = { first: FALLBACK_FIRST_YEAR, last: thisYear };
  if (yearBoundsCache && Date.now() - yearBoundsCache.at < YEAR_BOUNDS_TTL_MS) {
    return yearBoundsCache.value;
  }
  try {
    const res = await fetch(`${QW_URL}/api/v1/${LENTELE}_*/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: '*',
        max_hits: 0,
        aggs: {
          seniausia: { min: { field: 'priemimoData' } },
          naujausia: { max: { field: 'priemimoData' } },
        },
        format: 'json',
      }),
    });
    if (!res.ok) return fallback;
    const data: any = await res.json();
    // min/max grąžina f64 nanosekundes — metų tikslumui tikslumo su kaupu.
    const min = Number(data?.aggregations?.seniausia?.value);
    const max = Number(data?.aggregations?.naujausia?.value);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return fallback;
    const value = {
      first: new Date(min / NS_PER_MS).getUTCFullYear(),
      last: Math.max(new Date(max / NS_PER_MS).getUTCFullYear(), thisYear),
    };
    if (!Number.isInteger(value.first) || !Number.isInteger(value.last) || value.first > value.last) {
      return fallback;
    }
    yearBoundsCache = { at: Date.now(), value };
    return value;
  } catch {
    return fallback;
  }
}

/**
 * Priėmimo datų histograma slankikliui: po vieną kaušą metams, `range`
 * agregacija (Quickwit datetime fast laukas skaičiuojamas nanosekundėmis).
 * Rėžiai imami iš indekso, o ne iš konstantos.
 *
 * Nuo naujojo galo nukerpam tuščius metus, nuo senojo — retą „uodegą" (žr.
 * `HIST_TAIL_SHARE`), kad slankiklio domenas apimtų ten, kur duomenų iš tikrųjų
 * yra. Naudotojo pasirinkta „nuo" data domeną prasitęsia atgal, kad slankiklis
 * rodytų realią atrankos padėtį.
 */
async function qwDataHistogram(query: string, selectedFrom?: string | null): Promise<DataHistogram> {
  const { first: firstYear, last: lastYear } = await indexYearBounds();
  const selectedYear = selectedFrom ? new Date(`${selectedFrom}T00:00:00Z`).getUTCFullYear() : NaN;
  const ranges = [];
  for (let y = firstYear; y <= lastYear; y++) {
    ranges.push({ key: String(y), from: Date.UTC(y, 0, 1) * NS_PER_MS, to: Date.UTC(y + 1, 0, 1) * NS_PER_MS });
  }
  const empty: DataHistogram = {
    buckets: [],
    domainMin: Date.UTC(firstYear, 0, 1),
    domainMax: Date.UTC(lastYear + 1, 0, 1) - 1,
  };
  try {
    const res = await fetch(`${QW_URL}/api/v1/${LENTELE}_*/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        max_hits: 0,
        aggs: { years: { range: { field: 'priemimoData', ranges } } },
        format: 'json',
      }),
    });
    if (!res.ok) return empty;
    const data: any = await res.json();
    // Quickwit prideda dvi atviras (−∞, …) ir (…, +∞) skiltis — jos ne metai.
    const years = (data?.aggregations?.years?.buckets ?? [])
      .map((b: any) => ({ year: Number(b.key), count: Number(b.doc_count ?? 0) }))
      .filter((b: any) => Number.isInteger(b.year) && b.year >= firstYear)
      .sort((a: any, b: any) => a.year - b.year);

    const total = years.reduce((sum: number, b: any) => sum + b.count, 0);
    // Uodegos riba skaičiuojama nuo ŠIOS atrankos dydžio: susiaurinus paiešką
    // iki vien senų aktų riba susitraukia kartu ir nieko nebenukerpa.
    const tailLimit = total * HIST_TAIL_SHARE;

    let start = 0;
    let end = years.length - 1;
    while (end >= 0 && years[end].count === 0) end--;
    for (let acc = 0; start <= end; start++) {
      // Naudotojo pasirinktos „nuo" datos niekada neužkerpam — kitaip
      // slankiklio rankenėlė atsidurtų už domeno ribų.
      if (Number.isFinite(selectedYear) && years[start].year >= selectedYear) break;
      if (acc + years[start].count > tailLimit) break;
      acc += years[start].count;
    }
    const kept = years.slice(start, end + 1);
    if (!kept.length) return empty;

    return {
      buckets: kept.map((b: any) => ({
        from: Date.UTC(b.year, 0, 1),
        to: Date.UTC(b.year + 1, 0, 1),
        count: b.count,
      })),
      domainMin: Date.UTC(kept[0].year, 0, 1),
      domainMax: Date.UTC(kept[kept.length - 1].year + 1, 0, 1) - 1,
    };
  } catch {
    return empty;
  }
}

// ── Sidecar ištraukos ────────────────────────────────────────────────────────

let sidecar: any = null;
let sidecarFailed = false;
function getSidecar() {
  if (sidecar || sidecarFailed) return sidecar;
  try {
    sidecar = openETarSidecar({ readonly: true });
  } catch {
    // Sidecar'o nėra (pvz. kitas mazgas) — kortelės tiesiog lieka be ištraukos.
    sidecarFailed = true;
  }
  return sidecar;
}

/** Quickwit datetime (sekundės arba ISO) → „yyyy-mm-dd" arba null. */
function toDateString(value: unknown): string | null {
  if (value == null) return null;
  const date = typeof value === 'number'
    ? new Date(value * 1000)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

export async function searchTeisesAktai(input: {
  q?: string;
  page?: number;
  rusis?: string | string[];
  statusas?: string | string[];
  variantas?: string | string[];
  prieme?: string | string[];
  eurovoc?: string | string[];
  turinys?: string | string[];
  nuo?: string;
  iki?: string;
  istaigosNr?: string;
  regNr?: string;
  sort?: string;
  mode?: string;
}): Promise<TeisesAktaiSearchResult> {
  const rawQ = (input.q ?? '').trim();
  const page = Math.max(1, Number(input.page) || 1);
  const phrase = input.mode === 'phrase';
  const sort = resolveSort(input.sort);
  let sortBy = SORT_MAP.get(sort)!;

  const partsOpts = buildPartsOpts(input);
  const { textQuery } = partsOpts;

  // Be teksto `_score` visiems vienodas → Quickwit grąžintų nestabilią tvarką ir
  // puslapiavimas „šokinėtų". Krentam ant visada esančio lauko (naujausi pirma).
  const noTextTerms = !textQuery || textQuery === '*';
  if (sort === 'relevance' && noTextTerms) sortBy = 'priemimoData';

  const qwQuery = buildPartsExcluding(partsOpts);

  const t0 = Date.now();
  const mark = () => Date.now() - t0;
  const timings: Timing[] = [];

  const searchStart = mark();
  const searchPromise = search(
    LENTELE,
    { query: qwQuery, sort_by: sortBy },
    { minHits: page * PAGE_SIZE },
  );

  // Kiekvienas facetas skaičiuojamas be SAVO filtro — kitaip pasirinkus vieną
  // reikšmę visos kitos to paties faceto reikšmės dingtų iš sąrašo.
  const aggsStart = mark();
  const aggsPromise = Promise.all([
    qwAggregate('aktoRusis', buildPartsExcluding({ ...partsOpts, excludeRusis: true }), 30),
    qwAggregate('statusas', buildPartsExcluding({ ...partsOpts, excludeStatusas: true }), 12),
    qwAggregate('variantas', buildPartsExcluding({ ...partsOpts, excludeVariantas: true }), 5),
    qwAggregate('prieme', buildPartsExcluding({ ...partsOpts, excludePrieme: true }), 40),
    qwAggregate('eurovoc', buildPartsExcluding({ ...partsOpts, excludeEurovoc: true }), 60),
    qwAggregate('turinioBusena', buildPartsExcluding({ ...partsOpts, excludeTurinys: true }), 5),
    qwDataHistogram(buildPartsExcluding({ ...partsOpts, excludeData: true }), partsOpts.nuo),
  ]);

  const result: any = await searchPromise;
  const qwMs = result.qwMs ?? (mark() - searchStart);
  const filterMs = result.filterMs ?? 0;
  timings.push({ label: 'Paieška', phase: 'search', start: searchStart, duration: qwMs });
  if (filterMs > 0) {
    timings.push({ label: 'Gyvų atranka', phase: 'pg', start: searchStart + qwMs, duration: filterMs });
  }

  const [rusisRaw, statusasRaw, variantasRaw, priemeRaw, eurovocRaw, turinysRaw, dataHist] =
    await aggsPromise;
  timings.push({ label: 'Facetai', phase: 'filter', start: aggsStart, duration: mark() - aggsStart });

  const total = result.numHitsEstimate ?? result.hits.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHits = result.hits.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const hits: TeisesAktasHit[] = pageHits.map((h: any) => ({
    documentId: Number(h.documentId),
    legalActId: String(h.legalActId ?? ''),
    variantas: String(h.variantas ?? 'original'),
    redakcijosTokenas: str(h.redakcijosTokenas),
    md5: str(h.md5),
    url: str(h.url),
    pavadinimas: str(h.pavadinimas),
    aktoRusis: str(h.aktoRusis),
    statusas: str(h.statusas),
    prieme: str(h.prieme),
    istaigosNr: str(h.istaigosNr),
    registracijosNr: str(h.registracijosNr),
    publikuota: str(h.publikuota),
    eli: str(h.eli),
    eurovoc: arr(h.eurovoc),
    priedai: arr(h.priedai),
    prieduSkaicius: Number(h.prieduSkaicius ?? 0),
    redakcijuSkaicius: Number(h.redakcijuSkaicius ?? 0),
    turinioBusena: str(h.turinioBusena),
    priemimoData: toDateString(h.priemimoData),
    registracijosData: toDateString(h.registracijosData),
    isigaliojoNuo: toDateString(h.isigaliojoNuo),
    galiojaIki: toDateString(h.galiojaIki),
    snippet: null,
  }));

  // Ištraukos iš sidecar'o. Su paieškos žodžiais juos paryškinam; be teksto
  // užklausos vis tiek rodom akto pradžią, kad kortelė turėtų kontekstą.
  if (hits.length) {
    const snipStart = mark();
    const db = getSidecar();
    if (db) {
      const snippetQuery = textQuery && textQuery !== '*' ? textQuery : '';
      for (const hit of hits) {
        if (!hit.md5) continue;
        try {
          const payload: any = readResponse(db, hit.md5);
          const text = normalizeDocText(payload?.official_text?.text);
          if (text.length) hit.snippet = makeSnippet(text, snippetQuery, phrase ? 'phrase' : 'words');
        } catch { /* sidecar'o pralaimėjimas kortelės negriauna */ }
      }
    }
    timings.push({ label: 'Ištraukos', phase: 'count', start: snipStart, duration: mark() - snipStart });
  }

  const elapsed = (mark() / 1000).toFixed(2);

  const half = Math.floor(PAGINATION_WINDOW / 2);
  let pStart = Math.max(1, page - half);
  const pEnd = Math.min(totalPages, pStart + PAGINATION_WINDOW - 1);
  if (pEnd - pStart < PAGINATION_WINDOW - 1) pStart = Math.max(1, pEnd - PAGINATION_WINDOW + 1);
  const pageNums: number[] = [];
  if (totalPages > 0) for (let i = pStart; i <= pEnd; i++) pageNums.push(i);

  // Pasirinkta reikšmė lieka sąraše net jei jos nebėra tarp top-N — kitaip
  // filtro nebūtų kaip nusiimti.
  const withSelected = (options: FacetOption[], selected: string[]): FacetOption[] => {
    const known = new Set(options.map((o) => o.value));
    return [
      ...selected.filter((v) => !known.has(v)).map((value) => ({ value, count: null })),
      ...options,
    ];
  };

  return {
    q: rawQ,
    hits,
    total,
    approximate: !result.rawExhausted,
    elapsed,
    engine: 'quickwit',
    timings,
    page,
    totalPages,
    pageNums,
    sort,
    rusisFilter: partsOpts.rusys,
    statusasFilter: partsOpts.statusai,
    variantasFilter: partsOpts.variantai,
    priemeFilter: partsOpts.prieme,
    eurovocFilter: partsOpts.eurovoc,
    turinysFilter: partsOpts.turinys,
    nuo: partsOpts.nuo,
    iki: partsOpts.iki,
    istaigosNr: partsOpts.istaigosNr,
    regNr: partsOpts.regNr,
    rusisOptions: withSelected(rusisRaw, partsOpts.rusys),
    statusasOptions: withSelected(statusasRaw, partsOpts.statusai),
    variantasOptions: withSelected(variantasRaw, partsOpts.variantai),
    priemeOptions: withSelected(priemeRaw, partsOpts.prieme),
    eurovocOptions: withSelected(eurovocRaw, partsOpts.eurovoc),
    turinysOptions: withSelected(turinysRaw, partsOpts.turinys),
    dataHist,
  };
}

/**
 * Pilnas vieno faceto reikšmių sąrašas pagal dabartinę užklausą — „Daugiau"
 * modalui. Kaip ir šoninėje juostoje, faceto SAVO filtras praleidžiamas, tad
 * kiekviena rodoma reikšmė realiai siaurina esamus rezultatus.
 */
export async function teisesAktaiFacetOptions(
  field: string,
  input: Parameters<typeof buildPartsOpts>[0],
  size = 1000,
): Promise<FacetOption[]> {
  const facet = (FACETS as readonly FacetDef[]).find((f) => f.field === field);
  if (!facet) return [];
  const partsOpts = buildPartsOpts(input);
  const query = buildPartsExcluding({ ...partsOpts, [facet.exclude]: true } as Parameters<typeof buildPartsExcluding>[0]);
  return qwAggregate(field, query, size);
}
