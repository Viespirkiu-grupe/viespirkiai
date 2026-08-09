// Serverinis /teisesAktai puslapio kontroleris: išparsina query string'ą, paleidžia
// paiešką ir supakuoja rezultatus į paruoštus komponentų props'us, kad .astro
// frontmatter liktų plonas.
import {
  buildTeisesAktaiUrl,
  splitFacetOptions,
  toggleValue,
  type TeisesAktaiUrlOverrides,
  type TeisesAktaiUrlState,
} from './teisesAktaiUrl.ts';
import {
  TEISES_AKTAI_SORT_OPTIONS,
  emptyDataHistogram,
  searchTeisesAktai,
  type FacetOption,
} from './searchTeisesAktai.ts';

export async function loadTeisesAktaiPage(url: URL) {
  const params = url.searchParams;
  const q = (params.get('search') ?? params.get('q') ?? '').trim();
  const page = Math.max(1, parseInt(params.get('page') ?? params.get('p') ?? '1', 10) || 1);
  const mode = params.get('mode') === 'phrase' ? 'phrase' : 'words';
  const requestedSort = params.get('sort') ?? undefined;

  const joined = (key: string) =>
    params.getAll(key).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  const repeated = (key: string) => params.getAll(key).filter(Boolean);

  const searchInput = {
    q,
    rusis: joined('rusis'),
    statusas: joined('statusas'),
    variantas: joined('variantas'),
    turinys: joined('turinys'),
    prieme: repeated('prieme'),
    eurovoc: repeated('eurovoc'),
    // Priėmimo datos rėžis ateina iš histogramos slankiklio.
    nuo: params.get('nuo') ?? undefined,
    iki: params.get('iki') ?? undefined,
    istaigosNr: params.get('istaigosNr') ?? undefined,
    regNr: params.get('regNr') ?? undefined,
    mode,
  };

  const hasFilters = Boolean(
    searchInput.rusis.length || searchInput.statusas.length || searchInput.variantas.length
    || searchInput.turinys.length || searchInput.prieme.length || searchInput.eurovoc.length
    || searchInput.nuo || searchInput.iki || searchInput.istaigosNr || searchInput.regNr,
  );

  // Tuščia paieška be filtrų vis tiek rodo rezultatus (naujausi aktai) — teisės
  // aktų sąrašas yra prasminga pradžia, skirtingai nuo dokumentų paieškos.
  let result: Awaited<ReturnType<typeof searchTeisesAktai>> | null = null;
  let errorMessage = '';
  try {
    result = await searchTeisesAktai({ ...searchInput, page, sort: requestedSort });
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : 'Paieška nepavyko.';
  }

  const rusisFilter = result?.rusisFilter ?? [];
  const statusasFilter = result?.statusasFilter ?? [];
  const variantasFilter = result?.variantasFilter ?? [];
  const priemeFilter = result?.priemeFilter ?? [];
  const eurovocFilter = result?.eurovocFilter ?? [];
  const turinysFilter = result?.turinysFilter ?? [];
  const nuo = result?.nuo ?? null;
  const iki = result?.iki ?? null;
  const istaigosNr = result?.istaigosNr ?? null;
  const regNr = result?.regNr ?? null;
  const sort = result?.sort ?? 'relevance';

  const urlState: TeisesAktaiUrlState = {
    q, mode, sort,
    rusis: rusisFilter,
    statusas: statusasFilter,
    variantas: variantasFilter,
    prieme: priemeFilter,
    eurovoc: eurovocFilter,
    turinys: turinysFilter,
    nuo,
    iki,
    istaigosNr,
    regNr,
  };
  const buildUrl = (overrides: TeisesAktaiUrlOverrides = {}) => buildTeisesAktaiUrl(urlState, overrides);
  const toggle = (key: keyof TeisesAktaiUrlOverrides, current: string[]) =>
    (v: string) => buildUrl({ [key]: v ? toggleValue(current, v) : [] } as TeisesAktaiUrlOverrides);

  const facet = (
    key: keyof TeisesAktaiUrlOverrides,
    filter: string[],
    options: FacetOption[] | undefined,
    limit: number,
  ) => ({
    filter,
    ...splitFacetOptions(options ?? [], filter, limit),
    toggleUrl: toggle(key, filter),
  });

  const clearUrl = (() => {
    const sp = new URLSearchParams();
    if (q) sp.set('search', q);
    sp.set('mode', mode);
    if (sort !== 'relevance') sp.set('sort', sort);
    const qs = sp.toString();
    return qs ? `/teisesAktai?${qs}` : '/teisesAktai';
  })();

  const activeFilterCount = rusisFilter.length + statusasFilter.length + variantasFilter.length
    + priemeFilter.length + eurovocFilter.length + turinysFilter.length
    + (nuo || iki ? 1 : 0)
    + (istaigosNr ? 1 : 0) + (regNr ? 1 : 0);

  const resultsMetaHtml = (() => {
    const shown = result?.hits.length ?? 0;
    const prefix = result?.approximate ? 'apie ' : '';
    const count = (result?.total ?? 0).toLocaleString('lt-LT');
    const elapsed = result?.elapsed ?? '';
    const engine = result?.engine ?? '';
    const timings = result?.timings ?? [];
    const timingsAttr = timings.length
      ? ` data-timings='${JSON.stringify(timings).replace(/'/g, '&#39;')}'`
      : '';
    const source = `<span class="timing-source"${timingsAttr}>(${elapsed} s · ${engine})</span>`;
    return `Rodomi ${shown} iš ${prefix}${count} rezultatų ${source}`;
  })();

  return {
    errorMessage,
    q,
    mode,
    urlState,
    filtersProps: {
      activeFilterCount,
      hasFilters,
      clearUrl,
      rusis: facet('rusis', rusisFilter, result?.rusisOptions, 8),
      statusas: facet('statusas', statusasFilter, result?.statusasOptions, 6),
      variantas: facet('variantas', variantasFilter, result?.variantasOptions, 4),
      prieme: facet('prieme', priemeFilter, result?.priemeOptions, 8),
      eurovoc: facet('eurovoc', eurovocFilter, result?.eurovocOptions, 8),
      turinys: facet('turinys', turinysFilter, result?.turinysOptions, 4),
      dataHist: result?.dataHist ?? emptyDataHistogram(),
      nuo,
      iki,
      istaigosNr,
      regNr,
    },
    resultsProps: {
      hits: result?.hits ?? [],
      resultsMetaHtml,
      sort,
      sortOptions: TEISES_AKTAI_SORT_OPTIONS,
      q,
      page,
      totalPages: result?.totalPages ?? 0,
      pageNums: result?.pageNums ?? [],
      buildPageUrl: (p: number) => buildUrl({ page: p }),
    },
  };
}
