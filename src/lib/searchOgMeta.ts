/**
 * Brangių paieškos maršrutų OG/`<title>` tekstai — **tik iš URL parametrų**.
 *
 * Modulis sąmoningai grynas: nė vienos DB ar Quickwit užklausos, jokio I/O, jokių
 * serverinių priklausomybių. Taip jį gali kviesti ir `src/middleware.ts` (peržiūros
 * crawleriams, kurie iššūkio niekada neišspręs), ir patys paieškos puslapiai, ir
 * `.png` OG maršrutai — visi gauna identišką tekstą, o crawlerio užklausa nepaleidžia
 * brangios paieškos.
 *
 * Todėl kodai (JAR, BVPŽ, EVRK) rodomi kaip kodai: pavadinimams reikėtų DB.
 *
 * Etiketės imamos iš tų pačių žemėlapių, kuriuos naudoja puslapiai ir eksportai
 * (`sutartysFilterLabels.ts`, `dokumentaiLabels.ts`), kad tekstas neišsiskirtų.
 */
import { SUTARTYS_FILTER_LABELS } from './sutartysFilterLabels.ts';
import {
  CLASS_LABEL,
  DOKUMENTAI_PARAM_LABELS,
  LANG_LABEL,
  SOURCE_LABEL,
  TYPE_LABEL,
} from './dokumentaiLabels.ts';
import { eurovocLabel, statusasLabel, turinysLabel, variantasLabel } from './teisesAktaiLabels.ts';
import { DOKUMENTAI_SORT_OPTIONS } from './dokumentai/search/types.ts';
import { CONTRACT_TYPES } from '@/modules/sutartys/contractTypes.js';
import { PIRKIMO_BUDAS, STATUSAS } from '@/modules/viesiejiPirkimai/viesiejiPirkimaiEnums.js';

/** Numatytasis viešas adresas — toks pat, kokį jau naudoja puslapių `pageImage`. */
export const DEFAULT_ORIGIN = 'https://viespirkiai.org';

export type SearchRoute = '/' | '/viesiejiPirkimai' | '/dokumentai' | '/juridiniai';

export interface SearchFilterDescription {
  label: string;
  value: string;
}

export interface SearchOgMeta {
  route: SearchRoute;
  /** Maršruto pavadinimas be užklausos, pvz. „Sutarčių paieška". */
  baseTitle: string;
  /** Laisvo teksto užklausa (gali būti tuščia). */
  queryText: string;
  filters: SearchFilterDescription[];
  /** Ar užklausoje buvo bent tekstas arba vienas atpažintas filtras. */
  hasQuery: boolean;
  pageTitle: string;
  pageDescription: string;
  ogImageUrl: string;
  canonicalUrl: string;
}

/** Ilgio ribos: OG aprašymai vis tiek kerpami, o mums svarbu ribota rakto erdvė. */
const MAX_VALUE_LENGTH = 80;
const MAX_TITLE_LENGTH = 70;
const MAX_DESCRIPTION_LENGTH = 200;
const MAX_LISTED_FILTERS = 6;
/** Kiek reikšmių išvardijama daugiareikšmiame filtre, prieš „ir dar N". */
const MAX_LISTED_VALUES = 3;

type ValueFormatter = (value: string) => string | null;

interface FilterSpec {
  /** Etiketė; jei nenurodyta — imama iš maršruto etikečių žemėlapio. */
  label?: string;
  /** Reikšmės vertimas; `null` reiškia „reikšmė netinkama, filtrą praleisti". */
  format?: ValueFormatter;
  /** Reikšmė sudaryta iš kableliais (ar tarpais) atskirtų dalių. */
  multi?: boolean;
  /** Skirtukas daugiareikšmiam filtrui. */
  separator?: string;
  /** Filtras įsijungia nuo buvimo, o ne nuo reikšmės (pvz. `tikSuDokumentais`). */
  flag?: boolean;
}

interface RouteSpec {
  baseTitle: string;
  /** Aprašymas be užklausos — tas pat tekstas, kurį puslapiai rodė iki šiol. */
  baseDescription: string;
  /** Kilmininkas antraštei: „asfaltas – sutarčių paieška". */
  titleSuffix: string;
  /** Laisvo teksto parametrai (pirmas turintis reikšmę ir naudojamas). */
  textParams: string[];
  pngPath: string;
  labels: Record<string, string>;
  filters: Record<string, FilterSpec>;
}

// ─── reikšmių formatuotojai ──────────────────────────────────────────────────

const enumLabel = (map: Record<string, string>): ValueFormatter =>
  (value) => map[value] ?? value;

const eur: ValueFormatter = (value) => {
  const number = Number(value.replace(',', '.'));
  if (!Number.isFinite(number)) return null;
  return `${number.toLocaleString('lt-LT')} €`;
};

const integer: ValueFormatter = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return number.toLocaleString('lt-LT');
};

/** Data priimama tik `YYYY-MM-DD` — kitokia reikšmė filtrą praleidžia. */
const isoDate: ValueFormatter = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

const contractType = enumLabel(CONTRACT_TYPES as Record<string, string>);
const stripWww: ValueFormatter = (value) => value.replace(/^www\./, '');
const extension: ValueFormatter = (value) => `.${value}`;
const sourceLabel: ValueFormatter = (value) => SOURCE_LABEL[value.toLowerCase()] ?? value;
const langLabel: ValueFormatter = (value) => LANG_LABEL[value] ?? value.toUpperCase();

const dokumentaiSortLabel: ValueFormatter = (value) =>
  DOKUMENTAI_SORT_OPTIONS.find((option) => option.value === value)?.label ?? value;

/** `sort=verte:desc` — puslapiai rikiavimą laiko viena reikšme su kryptimi. */
const sortWithDirection: ValueFormatter = (value) => value.replace(':', ' ');

// ─── maršrutų registras ─────────────────────────────────────────────────────

const VIESIEJI_PIRKIMAI_LABELS: Record<string, string> = {
  search: 'Paieška',
  pvJarKodas: 'Pirkimo vykdytojo kodas',
  pirkimoId: 'Pirkimo ID',
  pirkimoBudas: 'Pirkimo būdas',
  statusas: 'Statusas',
  zingsnis: 'Žingsnis',
  type: 'Pirkimo tipas',
  bvpzPrefiksai: 'BVPŽ kodas',
  verteNuo: 'Numatoma vertė nuo',
  verteIki: 'Numatoma vertė iki',
  paskelbimoDataNuo: 'Paskelbta nuo',
  paskelbimoDataIki: 'Paskelbta iki',
  pasiulymuTerminasNuo: 'Pasiūlymų terminas nuo',
  pasiulymuTerminasIki: 'Pasiūlymų terminas iki',
  sort: 'Rikiavimas',
};

const JURIDINIAI_LABELS: Record<string, string> = {
  search: 'Paieška',
  adresas: 'Adresas',
  registracija: 'Registracija',
  forma: 'Teisinė forma',
  statusas: 'Statusas',
  apskritis: 'Apskritis',
  savivaldybe: 'Savivaldybė',
  evrk: 'EVRK',
  registravimoDataNuo: 'Registruota nuo',
  registravimoDataIki: 'Registruota iki',
  darbuotojaiNuo: 'Darbuotojų nuo',
  darbuotojaiIki: 'Darbuotojų iki',
  atlyginimasNuo: 'Atlyginimas nuo',
  atlyginimasIki: 'Atlyginimas iki',
  sort: 'Rikiavimas',
};

const REGISTRACIJA_LABEL: Record<string, string> = {
  registruoti: 'Registruoti',
  isregistruoti: 'Išregistruoti',
};

/**
 * Filtrų raktai atitinka atitinkamo maršruto skaitomus parametrus:
 * `/` — `modules/sutartys/search/filter.js`, `/viesiejiPirkimai` —
 * `modules/viesiejiPirkimai/search/filter.js`, `/dokumentai` —
 * `loadDokumentaiPage`, `/juridiniai` — `buildJuridiniaiQuickwitQuery`.
 * Eilės tvarka čia = eilės tvarka aprašyme.
 */
const ROUTES: Record<SearchRoute, RouteSpec> = {
  '/': {
    baseTitle: 'Sutarčių paieška',
    baseDescription: 'Pilietinė viešųjų pirkimų analizės iniciatyva. Prieinamai patiekiamos viešųjų pirkimų sutartys bei kita susijusi informacija.',
    titleSuffix: 'sutarčių paieška',
    textParams: ['search'],
    pngPath: '/sutartys.png',
    labels: SUTARTYS_FILTER_LABELS,
    filters: {
      perkanciosiosOrganizacijosKodas: { multi: true },
      tiekejoKodas: { multi: true },
      tipas: { multi: true, format: contractType },
      kategorija: { multi: true },
      bvpzPrefiksas: { multi: true, separator: ' ' },
      bvpzPrefiksasKitas: { multi: true, separator: ' ' },
      sumaNuo: { format: eur },
      sumaIki: { format: eur },
      verteNuo: { format: eur },
      verteIki: { format: eur },
      sudarymoDataNuo: { format: isoDate },
      sudarymoDataIki: { format: isoDate },
      sutartiesUnikalusID: {},
      sutartiesNumeris: {},
      pirkimoNumeris: {},
      tikSuDokumentais: { flag: true },
      ignoruotiSp: { flag: true },
      sort: { format: sortWithDirection },
    },
  },
  '/viesiejiPirkimai': {
    baseTitle: 'Viešųjų pirkimų paieška',
    baseDescription: 'Pilietinė viešųjų pirkimų analizės iniciatyva. Prieinamai patiekiami viešieji pirkimai bei kita susijusi informacija.',
    titleSuffix: 'viešųjų pirkimų paieška',
    textParams: ['search'],
    pngPath: '/viesiejiPirkimai.png',
    labels: VIESIEJI_PIRKIMAI_LABELS,
    filters: {
      pvJarKodas: { multi: true },
      pirkimoId: {},
      pirkimoBudas: { format: enumLabel(PIRKIMO_BUDAS as Record<string, string>) },
      statusas: { format: enumLabel(STATUSAS as Record<string, string>) },
      zingsnis: {},
      type: {},
      bvpzPrefiksai: { multi: true },
      verteNuo: { format: eur },
      verteIki: { format: eur },
      paskelbimoDataNuo: { format: isoDate },
      paskelbimoDataIki: { format: isoDate },
      pasiulymuTerminasNuo: { format: isoDate },
      pasiulymuTerminasIki: { format: isoDate },
      sort: { format: sortWithDirection },
    },
  },
  '/dokumentai': {
    baseTitle: 'Dokumentų paieška',
    baseDescription: 'Viešųjų pirkimų ir su jais susijusių dokumentų paieška pagal pavadinimą, autorių ir turinį.',
    titleSuffix: 'dokumentų paieška',
    textParams: ['search', 'q'],
    pngPath: '/dokumentai.png',
    labels: DOKUMENTAI_PARAM_LABELS,
    filters: {
      klase: { multi: true, format: enumLabel(CLASS_LABEL) },
      type: { multi: true, format: enumLabel(TYPE_LABEL) },
      teismas: { multi: true },
      bylosRusis: { multi: true },
      kategorija: { multi: true },
      teisejas: { multi: true },
      aktoRusis: { multi: true },
      galiojimas: { multi: true, format: statusasLabel },
      redakcija: { multi: true, format: variantasLabel },
      projektoBusena: { multi: true },
      eurovoc: { multi: true, format: eurovocLabel },
      prieme: { multi: true },
      turinys: { multi: true, format: turinysLabel },
      source: { multi: true, format: sourceLabel },
      istaiga: { multi: true },
      host: { multi: true, format: stripWww },
      jar: { multi: true },
      ext: { multi: true, format: extension },
      author: { multi: true },
      creator: { multi: true },
      producer: { multi: true },
      lang: { multi: true, format: langLabel },
      sav: { multi: true },
      apskritis: { multi: true },
      metai: { multi: true },
      istaigosNr: { multi: true },
      regNr: { multi: true },
      nuo: { format: isoDate },
      iki: { format: isoDate },
      sort: { format: dokumentaiSortLabel },
    },
  },
  '/juridiniai': {
    baseTitle: 'Juridinių asmenų paieška',
    baseDescription: 'Lietuvos juridinių asmenų paieška pagal pavadinimą, teisinę formą, statusą, veiklą ir vietą.',
    titleSuffix: 'juridinių asmenų paieška',
    textParams: ['search'],
    pngPath: '/juridiniai.png',
    labels: JURIDINIAI_LABELS,
    filters: {
      adresas: {},
      registracija: { format: enumLabel(REGISTRACIJA_LABEL) },
      forma: { multi: true },
      statusas: { multi: true },
      apskritis: { multi: true },
      savivaldybe: { multi: true },
      evrk: { multi: true },
      registravimoDataNuo: { format: isoDate },
      registravimoDataIki: { format: isoDate },
      darbuotojaiNuo: { format: integer },
      darbuotojaiIki: { format: integer },
      atlyginimasNuo: { format: eur },
      atlyginimasIki: { format: eur },
      sort: { format: sortWithDirection },
    },
  },
};

// ─── pagalbinės ─────────────────────────────────────────────────────────────

/** Kelias be pabaigos brūkšnio, kaip `isBotChallengePath`. */
function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/** Kontrolinių simbolių ir kartotinių tarpų nėra nei antraštėse, nei PNG. */
function sanitize(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/**
 * Visos parametro reikšmės: ir kartotiniai parametrai (`?jar=1&jar=2`), ir
 * kableliais atskirtos (`?jar=1,2`) — /dokumentai naudoja abu variantus.
 */
function collectValues(params: URLSearchParams, key: string, spec: FilterSpec): string[] {
  const raw = params.getAll(key);
  const parts = spec.multi
    ? raw.flatMap((value) => value.split(spec.separator ?? ','))
    : raw;
  const seen = new Set<string>();
  const values: string[] = [];
  for (const part of parts) {
    const value = sanitize(part);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

function describeFilter(key: string, spec: FilterSpec, route: RouteSpec, params: URLSearchParams): SearchFilterDescription | null {
  if (spec.flag) {
    const raw = params.get(key);
    if (raw === null || raw === 'false') return null;
    return { label: route.labels[key] ?? key, value: 'taip' };
  }

  const values = collectValues(params, key, spec);
  if (!values.length) return null;

  const formatted: string[] = [];
  for (const value of values) {
    const shown = spec.format ? spec.format(value) : value;
    if (shown === null) continue;
    formatted.push(truncate(sanitize(shown), MAX_VALUE_LENGTH));
  }
  if (!formatted.length) return null;

  const shown = formatted.slice(0, MAX_LISTED_VALUES).join(', ');
  const rest = formatted.length - MAX_LISTED_VALUES;
  return {
    label: spec.label ?? route.labels[key] ?? key,
    value: rest > 0 ? `${shown} ir dar ${rest}` : shown,
  };
}

/**
 * OG paveikslėlio URL. Parametrai atrenkami iš baltojo sąrašo ir surikiuojami, tad
 * ta pati paieška visada duoda tą patį URL — nuo to priklauso PNG cache
 * (žr. `searchOgImage.ts`) ir Cloudflare kešavimas.
 */
function buildOgImageUrl(route: RouteSpec, params: URLSearchParams, origin: string): string {
  const known = [...route.textParams, ...Object.keys(route.filters)];
  const selected: [string, string][] = [];
  for (const key of known) {
    const values = params.getAll(key).map(sanitize).filter(Boolean);
    for (const value of values) selected.push([key, truncate(value, MAX_VALUE_LENGTH)]);
  }
  selected.sort(([a, aValue], [b, bValue]) => (a === b ? aValue.localeCompare(bValue) : a.localeCompare(b)));
  const search = new URLSearchParams(selected).toString();
  return `${origin}${route.pngPath}${search ? `?${search}` : ''}`;
}

// ─── viešoji sąsaja ─────────────────────────────────────────────────────────

/** Ar tai vienas iš keturių brangių paieškos maršrutų. */
export function isSearchOgPath(pathname: string): boolean {
  return normalizePath(pathname) in ROUTES;
}

/**
 * Aprašo paieškos užklausą žmogui skirtu tekstu. `null`, jei kelias nėra vienas iš
 * keturių paieškos maršrutų.
 */
export function describeSearchQuery(
  pathname: string,
  params: URLSearchParams,
  origin: string = DEFAULT_ORIGIN,
): SearchOgMeta | null {
  const path = normalizePath(pathname) as SearchRoute;
  const route = ROUTES[path];
  if (!route) return null;

  const queryText = truncate(
    sanitize(route.textParams.map((key) => params.get(key) ?? '').find((value) => value.trim()) ?? ''),
    MAX_VALUE_LENGTH,
  );

  const filters: SearchFilterDescription[] = [];
  for (const [key, spec] of Object.entries(route.filters)) {
    // Laisvo teksto parametras jau atskirai antraštėje.
    if (route.textParams.includes(key)) continue;
    const described = describeFilter(key, spec, route, params);
    if (described) filters.push(described);
  }

  const pageTitle = truncate(
    queryText ? `${queryText} – ${route.titleSuffix}` : route.baseTitle,
    MAX_TITLE_LENGTH,
  );

  const listed = filters.slice(0, MAX_LISTED_FILTERS)
    .map(({ label, value }) => `${label.toLocaleLowerCase('lt-LT')} ${value}`)
    .join(', ');
  const hidden = filters.length - MAX_LISTED_FILTERS;
  const filtersSentence = listed
    ? `Filtrai: ${listed}${hidden > 0 ? ` ir dar ${hidden} filtrai` : ''}.`
    : '';

  const hasQuery = Boolean(queryText || filters.length);
  const pageDescription = truncate(
    filtersSentence ? `${route.baseTitle}. ${filtersSentence}` : route.baseDescription,
    MAX_DESCRIPTION_LENGTH,
  );

  return {
    route: path,
    baseTitle: route.baseTitle,
    queryText,
    filters,
    hasQuery,
    pageTitle,
    pageDescription,
    ogImageUrl: buildOgImageUrl(route, params, origin),
    canonicalUrl: `${origin}${path}${params.toString() ? `?${params}` : ''}`,
  };
}

/** Maršruto aprašas OG paveikslėlio maršrutams (`sutartys.png` ir kt.). */
export function searchRouteForPngPath(pngPath: string): SearchRoute | null {
  const entry = (Object.entries(ROUTES) as [SearchRoute, RouteSpec][])
    .find(([, route]) => route.pngPath === pngPath);
  return entry ? entry[0] : null;
}
