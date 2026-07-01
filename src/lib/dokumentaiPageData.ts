// Server-side controller for the /dokumentai page: parses the query string,
// runs the search + knowledge panels + stats + home overview, and packages the
// results into ready-to-spread props for the page's components. Keeps the .astro
// frontmatter thin — the page only wires cookies/config and renders.
import {
  buildDokumentaiUrl,
  splitFacetOptions,
  toggleValue,
  type DokumentaiUrlOverrides,
  type DokumentaiUrlState,
} from './dokumentaiUrl.ts';
import {
  DOKUMENTAI_SORT_OPTIONS,
  searchDokumentai,
  dokumentaiHomeOverview,
  dokumentaiFilterStats,
  extractInlineTokens,
  type FacetOption,
} from './searchDokumentai.ts';
import { findSingleBvpzPanel } from './searchBvpzPanel.ts';
import { findSingleJuridinisPanel } from './searchJuridinisPanel.ts';
import { findSutartisPanel } from './searchSutartisPanel.ts';

const HOST_LIMIT = 6;
const EXT_LIMIT = 6;

export async function loadDokumentaiPage(url: URL) {
  const params = url.searchParams;
  const q = (params.get('search') ?? params.get('q') ?? '').trim();
  const page = Math.max(1, parseInt(params.get('page') ?? params.get('p') ?? '1', 10) || 1);
  const mode = params.get('mode') === 'words' ? 'words' : 'phrase';
  const requestedSort = params.get('sort') ?? undefined;

  const rawClassFilter = params.getAll('klase').flatMap((v) => v.split(','));
  const rawTypeFilter = params.getAll('type').flatMap((v) => v.split(','));
  const rawHostFilter = params.getAll('host').flatMap((v) => v.split(','));
  const rawJarFilter = params.getAll('jar').flatMap((v) => v.split(','));
  const rawIstaigaFilter = params.getAll('istaiga').flatMap((v) => v.split(','));
  const rawExtFilter = params.getAll('ext').flatMap((v) => v.split(','));
  const rawAuthorFilter = params.getAll('author').filter(Boolean);
  const rawCreatorFilter = params.getAll('creator').filter(Boolean);
  const rawProducerFilter = params.getAll('producer').filter(Boolean);
  const rawLangFilter = params.getAll('lang').flatMap((v) => v.split(','));
  const rawSavFilter = params.getAll('sav').flatMap((v) => v.split(','));
  const rawApskritisFilter = params.getAll('apskritis').flatMap((v) => v.split(','));
  const rawSourceFilter = params.getAll('source').flatMap((v) => v.split(','));
  // Metai (happenedAt) — iš laiko juostos pasirinkti kalendoriniai metai.
  const rawMetaiFilter = params.getAll('metai').flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean);
  // Nuosprendžių metadata filtrai — reikšmės gali turėti kablelių, todėl NEskaidom.
  const rawCourtFilter = params.getAll('teismas').filter(Boolean);
  const rawCaseTypeFilter = params.getAll('bylosRusis').filter(Boolean);
  const rawCategoryFilter = params.getAll('kategorija').filter(Boolean);
  const rawJudgeFilter = params.getAll('teisejas').filter(Boolean);
  const rawActTypeFilter = params.getAll('aktoRusis').filter(Boolean);
  const rawValidityFilter = params.getAll('galiojimas').filter(Boolean);
  const rawEditionTypeFilter = params.getAll('redakcija').filter(Boolean);
  const rawProjectStatusFilter = params.getAll('projektoBusena').filter(Boolean);
  const rawEurovocFilter = params.getAll('eurovoc').filter(Boolean);

  // Geografinė sritis (stačiakampis) — filtruojama per Quickwit lat/lon range.
  const rawArea = {
    minLat: params.get('minLat') ?? undefined,
    maxLat: params.get('maxLat') ?? undefined,
    minLon: params.get('minLon') ?? undefined,
    maxLon: params.get('maxLon') ?? undefined,
  };
  const hasArea = Boolean(rawArea.minLat && rawArea.maxLat && rawArea.minLon && rawArea.maxLon);

  // Promote inline `class:`/`type:`/`host:`/`jar:`/`ext:` tokens out of the search box.
  {
    const { textQuery, classes, types, hosts, jars, exts } = extractInlineTokens(q);
    if (classes.length || types.length || hosts.length || jars.length || exts.length) {
      const sp = new URLSearchParams();
      if (textQuery) sp.set('search', textQuery);
      const merge = (existing: string[], incoming: string[]) =>
        [...new Set([...existing.map((v) => v.trim()).filter(Boolean), ...incoming])];
      const c = merge(rawClassFilter, classes);
      const t = merge(rawTypeFilter, types);
      const h = merge(rawHostFilter, hosts);
      const j = merge(rawJarFilter, jars);
      const e = merge(rawExtFilter, exts.map((x) => x.toLowerCase()));
      if (c.length) sp.set('klase', c.join(','));
      if (t.length) sp.set('type', t.join(','));
      if (h.length) sp.set('host', h.join(','));
      if (j.length) sp.set('jar', j.join(','));
      if (e.length) sp.set('ext', e.join(','));
      if (rawMetaiFilter.length) sp.set('metai', rawMetaiFilter.join(','));
      rawAuthorFilter.forEach((value) => sp.append('author', value));
      rawCreatorFilter.forEach((value) => sp.append('creator', value));
      rawProducerFilter.forEach((value) => sp.append('producer', value));
      rawCourtFilter.forEach((value) => sp.append('teismas', value));
      rawCaseTypeFilter.forEach((value) => sp.append('bylosRusis', value));
      rawCategoryFilter.forEach((value) => sp.append('kategorija', value));
      rawJudgeFilter.forEach((value) => sp.append('teisejas', value));
      rawActTypeFilter.forEach((value) => sp.append('aktoRusis', value));
      rawValidityFilter.forEach((value) => sp.append('galiojimas', value));
      rawEditionTypeFilter.forEach((value) => sp.append('redakcija', value));
      rawProjectStatusFilter.forEach((value) => sp.append('projektoBusena', value));
      rawEurovocFilter.forEach((value) => sp.append('eurovoc', value));
      sp.set('mode', mode);
      if (requestedSort && requestedSort !== 'relevance') sp.set('sort', requestedSort);
      if (page > 1) sp.set('page', String(page));
      return { redirect: `/dokumentai?${sp.toString()}` as const };
    }
  }

  const hasFilters = Boolean(
    rawClassFilter.length || rawTypeFilter.length || rawHostFilter.length || rawJarFilter.length || rawIstaigaFilter.length || rawExtFilter.length
    || rawAuthorFilter.length || rawCreatorFilter.length || rawProducerFilter.length
    || rawLangFilter.length || rawSavFilter.length || rawApskritisFilter.length || rawSourceFilter.length || rawMetaiFilter.length
    || rawCourtFilter.length || rawCaseTypeFilter.length || rawCategoryFilter.length || rawJudgeFilter.length
    || rawActTypeFilter.length || rawValidityFilter.length || rawEditionTypeFilter.length || rawProjectStatusFilter.length || rawEurovocFilter.length
    || hasArea,
  );
  const showHome = !q && !hasFilters;

  // Shared filter/query input — drives both the hit search and the right-rail
  // statistics aggregation, so they describe exactly the same selection.
  const searchInput = {
    q,
    klase: rawClassFilter,
    type: rawTypeFilter,
    host: rawHostFilter,
    jar: rawJarFilter,
    istaiga: rawIstaigaFilter,
    ext: rawExtFilter,
    author: rawAuthorFilter,
    creator: rawCreatorFilter,
    producer: rawProducerFilter,
    lang: rawLangFilter,
    sav: rawSavFilter,
    apskritis: rawApskritisFilter,
    source: rawSourceFilter,
    metai: rawMetaiFilter,
    teismas: rawCourtFilter,
    bylosRusis: rawCaseTypeFilter,
    kategorija: rawCategoryFilter,
    teisejas: rawJudgeFilter,
    aktoRusis: rawActTypeFilter,
    galiojimas: rawValidityFilter,
    redakcija: rawEditionTypeFilter,
    projektoBusena: rawProjectStatusFilter,
    eurovoc: rawEurovocFilter,
    minLat: rawArea.minLat,
    maxLat: rawArea.maxLat,
    minLon: rawArea.minLon,
    maxLon: rawArea.maxLon,
    mode,
  };

  let result: Awaited<ReturnType<typeof searchDokumentai>> | null = null;
  let juridinisPanel: Awaited<ReturnType<typeof findSingleJuridinisPanel>> = null;
  let bvpzPanel: Awaited<ReturnType<typeof findSingleBvpzPanel>> = null;
  let sutartisPanel: Awaited<ReturnType<typeof findSutartisPanel>> = null;
  let filterStats: Awaited<ReturnType<typeof dokumentaiFilterStats>> = null;
  let errorMessage = '';
  if (!showHome) {
    try {
      const panelsStart = performance.now();
      let juridinisDuration = 0;
      let bvpzDuration = 0;
      let sutartisDuration = 0;
      const timedJuridinis = async () => {
        const start = performance.now();
        const panel = await findSingleJuridinisPanel(q);
        juridinisDuration = performance.now() - start;
        return panel;
      };
      const timedBvpz = async () => {
        const start = performance.now();
        const panel = await findSingleBvpzPanel(q);
        bvpzDuration = performance.now() - start;
        return panel;
      };
      const timedSutartis = async () => {
        const start = performance.now();
        const panel = await findSutartisPanel(q);
        sutartisDuration = performance.now() - start;
        return panel;
      };
      // The statistics rail only appears once the user narrows the corpus with
      // filters; a bare text query is served by the knowledge panels instead.
      let statsDuration = 0;
      const timedStats = async () => {
        if (!hasFilters) return null;
        const start = performance.now();
        const stats = await dokumentaiFilterStats(searchInput);
        statsDuration = performance.now() - start;
        return stats;
      };
      [result, juridinisPanel, bvpzPanel, sutartisPanel, filterStats] = await Promise.all([
        searchDokumentai({ ...searchInput, page, sort: requestedSort }),
        timedJuridinis(),
        timedBvpz(),
        timedSutartis(),
        timedStats(),
      ]);
      // Align the panel headline with the (tombstone-corrected) results count.
      if (filterStats) filterStats.total = result.total;
      result.timings.push(
        { label: 'Juridinis asmuo', phase: 'pg', start: 0, duration: Math.round(juridinisDuration) },
        { label: 'BVPŽ kodas', phase: 'pg', start: 0, duration: Math.round(bvpzDuration) },
        { label: 'Sutartis', phase: 'pg', start: 0, duration: Math.round(sutartisDuration) },
        { label: 'Statistika', phase: 'pg', start: 0, duration: Math.round(statsDuration) },
      );
      const totalElapsed = performance.now() - panelsStart;
      result.elapsed = (totalElapsed / 1000).toFixed(2);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : 'Paieška nepavyko.';
    }
  }

  // Empty-search home: a Quickwit-aggregated portrait of the whole corpus.
  const homeOverview = showHome ? await dokumentaiHomeOverview() : null;

  const classFilter = result?.classFilter ?? [];
  const typeFilter = result?.typeFilter ?? [];
  const hostFilter = result?.hostFilter ?? [];
  const jarFilter = result?.jarFilter ?? [];
  const istaigaJarFilter = result?.istaigaJarFilter ?? [];
  const extFilter = result?.extFilter ?? [];
  const authorFilter = result?.authorFilter ?? [];
  const creatorFilter = result?.creatorFilter ?? [];
  const producerFilter = result?.producerFilter ?? [];
  const langFilter = result?.langFilter ?? [];
  const savFilter = result?.savFilter ?? [];
  const apskritisFilter = result?.apskritisFilter ?? [];
  const sourceFilter = result?.sourceFilter ?? [];
  const metaiFilter = result?.metaiFilter ?? [];
  const courtFilter = result?.courtFilter ?? [];
  const caseTypeFilter = result?.caseTypeFilter ?? [];
  const categoryFilter = result?.categoryFilter ?? [];
  const judgeFilter = result?.judgeFilter ?? [];
  const actTypeFilter = result?.actTypeFilter ?? [];
  const validityFilter = result?.validityFilter ?? [];
  const editionTypeFilter = result?.editionTypeFilter ?? [];
  const projectStatusFilter = result?.projectStatusFilter ?? [];
  const eurovocFilter = result?.eurovocFilter ?? [];
  const typeCountMap = result?.typeCountMap ?? {};
  const classCountMap = result?.classCountMap ?? {};
  const bbox = result?.bbox ?? null;
  const sort = result?.sort ?? 'relevance';

  const opt = (o: FacetOption[] | undefined) => o ?? [];

  const urlState: DokumentaiUrlState = {
    q, mode, sort,
    klase: classFilter,
    type: typeFilter,
    host: hostFilter,
    jar: jarFilter,
    istaiga: istaigaJarFilter,
    ext: extFilter,
    author: authorFilter,
    creator: creatorFilter,
    producer: producerFilter,
    lang: langFilter,
    sav: savFilter,
    apskritis: apskritisFilter,
    source: sourceFilter,
    metai: metaiFilter,
    teismas: courtFilter,
    bylosRusis: caseTypeFilter,
    kategorija: categoryFilter,
    teisejas: judgeFilter,
    aktoRusis: actTypeFilter,
    galiojimas: validityFilter,
    redakcija: editionTypeFilter,
    projektoBusena: projectStatusFilter,
    eurovoc: eurovocFilter,
    area: bbox,
  };
  const buildUrl = (overrides: DokumentaiUrlOverrides = {}) => buildDokumentaiUrl(urlState, overrides);
  // A facet's toggle-url flips one value on/off (empty value ⇒ clear the facet).
  const toggle = (key: keyof DokumentaiUrlOverrides, current: string[]) =>
    (v: string) => buildUrl({ [key]: v ? toggleValue(current, v) : [] } as DokumentaiUrlOverrides);

  const clearUrl = (() => {
    const sp = new URLSearchParams();
    if (q) sp.set('search', q);
    sp.set('mode', mode);
    if (sort !== 'relevance') sp.set('sort', sort);
    const qs = sp.toString();
    return qs ? `/dokumentai?${qs}` : '/dokumentai';
  })();

  // Split each facet's options into shown + overflow ("Daugiau"/"Rodyti daugiau").
  const split = (options: FacetOption[] | undefined, selected: string[], limit: number) =>
    splitFacetOptions(opt(options), selected, limit);
  const facet = (
    key: keyof DokumentaiUrlOverrides,
    filter: string[],
    options: FacetOption[] | undefined,
    limit: number,
  ) => ({ filter, ...split(options, filter, limit), toggleUrl: toggle(key, filter) });

  const showVerdictFacets = classFilter.includes('teise')
    || courtFilter.length > 0 || caseTypeFilter.length > 0
    || categoryFilter.length > 0 || judgeFilter.length > 0;
  const showTeisekuraFacets = classFilter.includes('teisekura')
    || actTypeFilter.length > 0 || validityFilter.length > 0 || editionTypeFilter.length > 0
    || projectStatusFilter.length > 0 || eurovocFilter.length > 0;

  const activeFilterCount = classFilter.length + typeFilter.length + hostFilter.length + jarFilter.length + istaigaJarFilter.length + extFilter.length
    + authorFilter.length + creatorFilter.length + producerFilter.length
    + langFilter.length + savFilter.length + apskritisFilter.length + sourceFilter.length + metaiFilter.length
    + courtFilter.length + caseTypeFilter.length + categoryFilter.length + judgeFilter.length
    + actTypeFilter.length + validityFilter.length + editionTypeFilter.length + projectStatusFilter.length + eurovocFilter.length
    + (bbox ? 1 : 0);

  // Results meta: count + a hoverable duration that reveals the per-phase timing
  // waterfall (which engine/index, how long each step took).
  const resultsMetaHtml = (() => {
    const prefix = result?.approximate ? 'Apie ' : '';
    const count = (result?.total ?? 0).toLocaleString('lt-LT');
    const elapsed = result?.elapsed ?? '';
    const engine = result?.engine ?? '';
    const timings = result?.timings ?? [];
    const timingsAttr = timings.length
      ? ` data-timings='${JSON.stringify(timings).replace(/'/g, '&#39;')}'`
      : '';
    const source = `<span class="timing-source"${timingsAttr}>(${elapsed} s · ${engine})</span>`;
    return `${prefix}${count} rezultatų ${source}`;
  })();

  return {
    redirect: null,
    showHome,
    errorMessage,
    q,
    mode,
    homeOverview,
    urlState,
    sutartisPanel,
    juridinisPanel,
    bvpzPanel,
    filterStats,
    // Ready-to-spread props for the sidebar and the results region.
    filtersProps: {
      activeFilterCount,
      hasFilters,
      clearUrl,
      classCountMap,
      classFilter,
      classToggleUrl: toggle('klase', classFilter),
      typeCountMap,
      typeFilter,
      typeToggleUrl: toggle('type', typeFilter),
      showVerdictFacets,
      showTeisekuraFacets,
      court: facet('teismas', courtFilter, result?.courtOptions, 8),
      caseType: facet('bylosRusis', caseTypeFilter, result?.caseTypeOptions, 8),
      category: facet('kategorija', categoryFilter, result?.categoryOptions, 8),
      judge: facet('teisejas', judgeFilter, result?.judgeOptions, 8),
      actType: facet('aktoRusis', actTypeFilter, result?.actTypeOptions, 8),
      validity: facet('galiojimas', validityFilter, result?.validityOptions, 8),
      editionType: facet('redakcija', editionTypeFilter, result?.editionTypeOptions, 8),
      projectStatus: facet('projektoBusena', projectStatusFilter, result?.projectStatusOptions, 8),
      eurovoc: facet('eurovoc', eurovocFilter, result?.eurovocOptions, 8),
      source: facet('source', sourceFilter, result?.sourceOptions, 8),
      istaiga: facet('istaiga', istaigaJarFilter, result?.istaigaJarOptions, HOST_LIMIT),
      host: facet('host', hostFilter, result?.hostOptions, HOST_LIMIT),
      jar: facet('jar', jarFilter, result?.jarOptions, EXT_LIMIT),
      ext: facet('ext', extFilter, result?.extOptions, EXT_LIMIT),
      author: facet('author', authorFilter, result?.authorOptions, EXT_LIMIT),
      creator: facet('creator', creatorFilter, result?.creatorOptions, EXT_LIMIT),
      producer: facet('producer', producerFilter, result?.producerOptions, EXT_LIMIT),
      lang: facet('lang', langFilter, result?.langOptions, 8),
      sav: facet('sav', savFilter, result?.savOptions, 6),
      apskritis: facet('apskritis', apskritisFilter, result?.apskritisOptions, 6),
      metaiFilter,
      metaiToggleUrl: toggle('metai', metaiFilter),
      bbox,
      areaClearUrl: buildUrl({ area: null }),
    },
    resultsProps: {
      hits: result?.hits ?? [],
      resultsMetaHtml,
      sort,
      sortOptions: DOKUMENTAI_SORT_OPTIONS,
      q,
      page,
      totalPages: result?.totalPages ?? 0,
      pageNums: result?.pageNums ?? [],
      buildPageUrl: (p: number) => buildUrl({ page: p }),
    },
  };
}
