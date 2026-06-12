import type { DokumentaiSort, FacetOption } from './searchDokumentai.ts';

export interface DokumentaiArea {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface DokumentaiUrlState {
  q: string;
  mode: 'words' | 'phrase';
  sort: DokumentaiSort;
  klase: string[];
  type: string[];
  host: string[];
  jar: string[];
  istaiga: string[];
  ext: string[];
  author: string[];
  creator: string[];
  producer: string[];
  lang: string[];
  sav: string[];
  apskritis: string[];
  source: string[];
  /** Pasirinkti metai (happenedAt) — kelių metų OR atranka iš laiko juostos. */
  metai: string[];
  teismas: string[];
  bylosRusis: string[];
  kategorija: string[];
  teisejas: string[];
  aktoRusis?: string[];
  galiojimas?: string[];
  redakcija?: string[];
  projektoBusena?: string[];
  eurovoc?: string[];
  area: DokumentaiArea | null;
}

export type DokumentaiUrlOverrides = Partial<Omit<DokumentaiUrlState, 'q' | 'mode'>> & {
  page?: number | null;
};

export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function buildDokumentaiUrl(
  state: DokumentaiUrlState,
  overrides: DokumentaiUrlOverrides = {},
): string {
  const selected = { ...state, ...overrides };
  const params = new URLSearchParams();

  if (selected.q) params.set('search', selected.q);
  params.set('mode', selected.mode);
  if (selected.sort !== 'relevance') params.set('sort', selected.sort);

  for (const key of ['klase', 'type', 'host', 'jar', 'istaiga', 'ext', 'lang', 'sav', 'apskritis', 'source', 'metai'] as const) {
    if (selected[key].length) params.set(key, selected[key].join(','));
  }
  // Reikšmės gali turėti kablelių (autoriai, kategorijų/teismų pavadinimai) — kartojam.
  for (const key of ['author', 'creator', 'producer', 'teismas', 'bylosRusis', 'kategorija', 'teisejas', 'aktoRusis', 'galiojimas', 'redakcija', 'projektoBusena', 'eurovoc'] as const) {
    for (const value of selected[key] ?? []) params.append(key, value);
  }

  if (selected.area) {
    params.set('minLat', String(selected.area.minLat));
    params.set('maxLat', String(selected.area.maxLat));
    params.set('minLon', String(selected.area.minLon));
    params.set('maxLon', String(selected.area.maxLon));
  }
  if (overrides.page) params.set('page', String(overrides.page));

  return `/dokumentai?${params.toString()}`;
}

export function splitFacetOptions(options: FacetOption[], selected: string[], limit: number) {
  const shown = [...options];
  for (const value of selected) {
    if (!shown.some((option) => option.value === value)) {
      shown.unshift({ value, count: null });
    }
  }
  return { visible: shown.slice(0, limit), hidden: shown.slice(limit) };
}
