import type { FacetOption, TeisesAktaiSort } from './searchTeisesAktai.ts';

/** Vienas šoninės juostos facetas: atranka, matomos + paslėptos parinktys, URL. */
export interface TaFacet {
  filter: string[];
  visible: FacetOption[];
  hidden?: FacetOption[];
  toggleUrl: (value: string) => string;
}

export interface TeisesAktaiUrlState {
  q: string;
  mode: 'words' | 'phrase';
  sort: TeisesAktaiSort;
  rusis: string[];
  statusas: string[];
  variantas: string[];
  prieme: string[];
  eurovoc: string[];
  turinys: string[];
  /** Priėmimo datos rėžis „yyyy-mm-dd" iš histogramos slankiklio. */
  nuo: string | null;
  iki: string | null;
  /** Tikslūs numeriai iš įvedimo laukų. */
  istaigosNr: string | null;
  regNr: string | null;
}

export type TeisesAktaiUrlOverrides = Partial<Omit<TeisesAktaiUrlState, 'q' | 'mode'>> & {
  page?: number | null;
};

/** Reikšmės, kuriose kablelis įmanomas → URL'e kartojam raktą, nejungiam. */
const REPEATED = ['prieme', 'eurovoc'] as const;
const JOINED = ['rusis', 'statusas', 'variantas', 'turinys'] as const;
/** Vienareikšmiai filtrai — datos rėžis ir numeriai. */
const SCALARS = ['nuo', 'iki', 'istaigosNr', 'regNr'] as const;

export function toggleValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

export function buildTeisesAktaiUrl(
  state: TeisesAktaiUrlState,
  overrides: TeisesAktaiUrlOverrides = {},
): string {
  const selected = { ...state, ...overrides };
  const params = new URLSearchParams();

  if (selected.q) params.set('search', selected.q);
  params.set('mode', selected.mode);
  if (selected.sort !== 'relevance') params.set('sort', selected.sort);

  for (const key of JOINED) {
    if (selected[key]?.length) params.set(key, selected[key].join(','));
  }
  for (const key of REPEATED) {
    for (const value of selected[key] ?? []) params.append(key, value);
  }
  for (const key of SCALARS) {
    if (selected[key]) params.set(key, selected[key] as string);
  }
  if (overrides.page) params.set('page', String(overrides.page));

  return `/teisesAktai?${params.toString()}`;
}

/** Parinktis padalija į rodomas ir „Daugiau" sąrašą; pasirinktos visada matomos. */
export function splitFacetOptions(options: FacetOption[], selected: string[], limit: number) {
  const shown = [...options];
  for (const value of selected) {
    if (!shown.some((option) => option.value === value)) {
      shown.unshift({ value, count: null });
    }
  }
  return { visible: shown.slice(0, limit), hidden: shown.slice(limit) };
}
