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
  type: string[];
  host: string[];
  jar: string[];
  ext: string[];
  lang: string[];
  sav: string[];
  apskritis: string[];
  source: string[];
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

  for (const key of ['type', 'host', 'jar', 'ext', 'lang', 'sav', 'apskritis', 'source'] as const) {
    if (selected[key].length) params.set(key, selected[key].join(','));
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
