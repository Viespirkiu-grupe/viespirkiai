// Planuojamų pirkimų (EPPS) paieškos užklausų branduolys: filtrų nuskaitymas iš
// URL, WHERE sąlygų dėliojimas ir facetų parinktys. Bendras puslapiui
// (/planuojamiPirkimai) ir „Daugiau" dialogų API (/api/planuojamiPirkimaiFacet),
// kad abi vietos filtrus suprastų vienodai.
//
// Variklis — vien Postgres (~87 tūkst. eilučių). Greitis laikosi ant to, kad
// filtrai ir `GROUP BY` dirba su žinynų ID (sveikais skaičiais) ant pačios
// `planuojamiPirkimai` lentelės, o pavadinimai prilipdomi tik apkarpytam sąrašui.
import { postgres } from '@/postgres/postgres.js';
import { SqlParams, parseMultiParam, toFacetOptions, type PgFacetOption } from './pgFacets.ts';

/** BVPŽ kodai gyvena viename tarpais skiriamame lauke — kaip /sutartys. */
export const BVPZ_PARAM = 'bvpzPrefiksasKitas';
export const BVPZ_SEP = ' ';
export const PIRKEJAS_PARAM = 'pirkejoKodas';

export const FACET_PARAMS = [PIRKEJAS_PARAM, 'tipas', 'budas', 'direktyva', BVPZ_PARAM] as const;
export const sepFor = (param: string) => (param === BVPZ_PARAM ? BVPZ_SEP : undefined);

export const DATA_JOIN = 'JOIN "eppsPlanuojamiPirkimai"."duomenys" d ON d."pirkimoId" = p.id';

type Dim = { id: number; pavadinimas: string };

export interface PlanuojamiContext {
  search: string;
  selected: Record<string, string[]>;
  kainaNuo: string;
  kainaIki: string;
  pradziaNuo: string;
  pradziaIki: string;
  activeFilterCount: number;
  tipaiById: Map<number, string>;
  budaiById: Map<number, string>;
  direktyvosById: Map<number, string>;
  needsData: (skipFacet?: string) => boolean;
  buildWhere: (params: SqlParams, skipFacet?: string) => string;
  selectedIds: Record<string, number[]>;
}

/**
 * Nuskaito filtrus iš URL ir paruošia užklausų kontekstą. Žinynai (3 / 19 / 5
 * eilutės) traukiami iškart — jų reikia ir pavadinimams, ir pasirinktų reikšmių
 * vertimui į ID.
 */
export async function planuojamiContext(url: URL): Promise<PlanuojamiContext> {
  const query = Object.fromEntries(url.searchParams) as Record<string, string>;
  const search = query.search || '';

  const selected: Record<string, string[]> = Object.fromEntries(
    FACET_PARAMS.map((param) => [param, parseMultiParam(url, param, sepFor(param))]),
  );
  selected[BVPZ_PARAM] = selected[BVPZ_PARAM].filter((code) => /^\d{2,8}$/.test(code));
  selected[PIRKEJAS_PARAM] = selected[PIRKEJAS_PARAM].filter((code) => /^\d{3,12}$/.test(code));

  const kainaNuo = (query.kainaNuo || '').trim();
  const kainaIki = (query.kainaIki || '').trim();
  const pradziaNuo = (query.pradziaNuo || '').trim();
  const pradziaIki = (query.pradziaIki || '').trim();

  const [tipaiRes, budaiRes, direktyvosRes, pirkejaiRes] = await Promise.all([
    postgres.query('SELECT id, pavadinimas FROM "eppsPlanuojamiPirkimai"."tipai"'),
    postgres.query('SELECT id, pavadinimas FROM "eppsPlanuojamiPirkimai"."budai"'),
    postgres.query('SELECT id, pavadinimas FROM "eppsPlanuojamiPirkimai"."direktyvos"'),
    selected[PIRKEJAS_PARAM].length
      ? postgres.query(
          'SELECT id FROM "eppsPlanuojamiPirkimai"."vykdytojai" WHERE "jarKodas" = ANY($1)',
          [selected[PIRKEJAS_PARAM]],
        )
      : Promise.resolve({ rows: [] as { id: number }[] }),
  ]);

  const byId = (rows: Dim[]) => new Map(rows.map((row) => [row.id, row.pavadinimas]));
  // Pasirinkti pavadinimai → ID. Nerastas pavadinimas virsta -1: rezultatų
  // nebus, bet filtras lieka matomas juostoje (o ne tyliai dingsta).
  const toIds = (names: string[], rows: Dim[]) => {
    const idByName = new Map(rows.map((row) => [row.pavadinimas, row.id]));
    return names.map((name) => idByName.get(name) ?? -1);
  };

  // Pirkėjas renkamas JAR kodu (kaip /sutartys), tad kodas verčiamas į vykdytojų
  // ID — tas pats kodas gali turėti kelis pavadinimo variantus. Nežinomas kodas
  // (naudotojo įvestas ranka) duoda -1: rezultatų nėra, bet filtras lieka matomas.
  const pirkejoIds = pirkejaiRes.rows.map((row: any) => Number(row.id));
  const selectedIds: Record<string, number[]> = {
    tipas: toIds(selected.tipas, tipaiRes.rows),
    budas: toIds(selected.budas, budaiRes.rows),
    direktyva: toIds(selected.direktyva, direktyvosRes.rows),
    [PIRKEJAS_PARAM]: selected[PIRKEJAS_PARAM].length && !pirkejoIds.length ? [-1] : pirkejoIds,
  };

  const quoteMatch = search.match(/^"(.*)"$/);
  const tsQueryFunc = quoteMatch ? 'phraseto_tsquery' : 'plainto_tsquery';
  const cleanSearch = quoteMatch ? quoteMatch[1] : search;

  /** Ar užklausai reikia `planuojamiPirkimaiDuomenys` (kaina / datos)? */
  const needsData = (skipFacet?: string) =>
    (skipFacet !== 'kaina' && (kainaNuo !== '' || kainaIki !== ''))
    || (skipFacet !== 'pradzia' && (pradziaNuo !== '' || pradziaIki !== ''));

  /**
   * WHERE sąlygos iš paieškos + filtrų. `skipFacet` praleidžia vieną filtrą — jo
   * paties skaičiavimams (facet-exclude), kad daugiareikšmė atranka nenumuštų
   * likusių to paties faceto variantų iki nulio, o histogramos rodytų visą rėžį.
   */
  const buildWhere = (params: SqlParams, skipFacet?: string) => {
    const conditions: string[] = [];
    if (cleanSearch) {
      conditions.push(`EXISTS (
        SELECT 1 FROM "eppsPlanuojamiPirkimai"."search" s
        WHERE s."pirkimoId" = p.id AND s."searchTsv" @@ ${tsQueryFunc}('simple', ${params.add(cleanSearch)}))`);
    }
    if (skipFacet !== PIRKEJAS_PARAM && selectedIds[PIRKEJAS_PARAM].length) {
      conditions.push(`p."vykdytojoId" = ANY(${params.add(selectedIds[PIRKEJAS_PARAM])}::bigint[])`);
    }
    if (skipFacet !== 'tipas' && selectedIds.tipas.length) {
      conditions.push(`p."pirkimoTipoId" = ANY(${params.add(selectedIds.tipas)}::smallint[])`);
    }
    if (skipFacet !== 'budas' && selectedIds.budas.length) {
      conditions.push(`p."pirkimoBudoId" = ANY(${params.add(selectedIds.budas)}::smallint[])`);
    }
    if (skipFacet !== 'direktyva' && selectedIds.direktyva.length) {
      conditions.push(`p."direktyvosId" = ANY(${params.add(selectedIds.direktyva)}::smallint[])`);
    }
    if (skipFacet !== BVPZ_PARAM && selected[BVPZ_PARAM].length) {
      conditions.push(`EXISTS (
        SELECT 1 FROM "eppsPlanuojamiPirkimai"."bvpzKodai" bk
        WHERE bk."pirkimoId" = p.id
          AND bk."bvpzKodas" LIKE ANY(${params.add(selected[BVPZ_PARAM].map((code) => `${code}%`))}::text[]))`);
    }
    if (skipFacet !== 'kaina') {
      if (kainaNuo) conditions.push(`d."apskaiciuotaKaina" >= ${params.add(kainaNuo)}::numeric`);
      if (kainaIki) conditions.push(`d."apskaiciuotaKaina" <= ${params.add(kainaIki)}::numeric`);
    }
    if (skipFacet !== 'pradzia') {
      if (pradziaNuo) conditions.push(`d."pirkimoPradziosData" >= ${params.add(pradziaNuo)}::date`);
      if (pradziaIki) conditions.push(`d."pirkimoPradziosData" < ${params.add(pradziaIki)}::date + 1`);
    }
    return conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  };

  const activeFilterCount = FACET_PARAMS.reduce((sum, param) => sum + selected[param].length, 0)
    + (kainaNuo ? 1 : 0) + (kainaIki ? 1 : 0) + (pradziaNuo ? 1 : 0) + (pradziaIki ? 1 : 0);

  return {
    search,
    selected,
    kainaNuo,
    kainaIki,
    pradziaNuo,
    pradziaIki,
    activeFilterCount,
    tipaiById: byId(tipaiRes.rows),
    budaiById: byId(budaiRes.rows),
    direktyvosById: byId(direktyvosRes.rows),
    needsData,
    buildWhere,
    selectedIds,
  };
}

/**
 * Pirkėjų facetas JAR kodais (kaip /sutartys): grupuojama pagal `vykdytojoId`,
 * pavadinimai prilipdomi jau apkarpytam TOP sąrašui. Tas pats JAR kodas gali
 * turėti kelis pavadinimo variantus — sudedami į vieną eilutę.
 */
export async function pirkejasFacetOptions(
  ctx: PlanuojamiContext,
  { size = 500, optionSearch = '' }: { size?: number; optionSearch?: string } = {},
): Promise<PgFacetOption[]> {
  const params = new SqlParams();
  const where = ctx.buildWhere(params, PIRKEJAS_PARAM);
  const ids = ctx.selectedIds[PIRKEJAS_PARAM];
  const pinned = ids.length ? `(p."vykdytojoId" = ANY(${params.add(ids)}::bigint[])) DESC, ` : '';
  const needle = optionSearch
    ? `AND (v.pavadinimas ILIKE ${params.add(`%${optionSearch}%`)} OR v."jarKodas" LIKE ${params.add(`${optionSearch}%`)})`
    : '';

  const { rows } = await postgres.query(
    `SELECT v."jarKodas" AS value, SUM(x.count)::int AS count, MIN(v.pavadinimas) AS label
     FROM (
       SELECT p."vykdytojoId" AS vid, COUNT(*)::int AS count
       FROM "eppsPlanuojamiPirkimai"."pirkimai" p
       ${ctx.needsData(PIRKEJAS_PARAM) ? DATA_JOIN : ''}
       ${where}
       GROUP BY 1
       HAVING p."vykdytojoId" IS NOT NULL
       ORDER BY ${pinned}count DESC, 1
       LIMIT ${Math.max(size, 500)}
     ) x
     JOIN "eppsPlanuojamiPirkimai"."vykdytojai" v ON v.id = x.vid
     WHERE COALESCE(v."jarKodas", '') <> '' ${needle}
     GROUP BY 1
     ORDER BY count DESC, label
     LIMIT ${size}`,
    params.values,
  );
  return toFacetOptions(rows);
}

/**
 * BVPŽ kodų facetas: skaičiuojama ryšių lentelėje (vienas pirkimas gali turėti
 * kelis kodus), pavadinimai — iš `bvpzKodai` žinyno. Pasirinktos reikšmės gali
 * būti ir nepilni kodai (prefiksai), tad jos pririšamos per LIKE ir lieka viršuje.
 */
export async function bvpzFacetOptions(
  ctx: PlanuojamiContext,
  { size = 500, optionSearch = '' }: { size?: number; optionSearch?: string } = {},
): Promise<PgFacetOption[]> {
  const params = new SqlParams();
  const where = ctx.buildWhere(params, BVPZ_PARAM);
  const chosen = ctx.selected[BVPZ_PARAM];
  const pinned = chosen.length
    ? `(bk."bvpzKodas" LIKE ANY(${params.add(chosen.map((code) => `${code}%`))}::text[])) DESC, `
    : '';
  const needle = optionSearch
    ? `WHERE x.code LIKE ${params.add(`${optionSearch}%`)} OR b.pavadinimas ILIKE ${params.add(`%${optionSearch}%`)}`
    : '';

  const { rows } = await postgres.query(
    `SELECT x.code AS value, x.count, b.pavadinimas AS label
     FROM (
       SELECT bk."bvpzKodas" AS code, COUNT(*)::int AS count
       FROM "eppsPlanuojamiPirkimai"."bvpzKodai" bk
       JOIN "eppsPlanuojamiPirkimai"."pirkimai" p ON p.id = bk."pirkimoId"
       ${ctx.needsData(BVPZ_PARAM) ? DATA_JOIN : ''}
       ${where}
       GROUP BY 1
       ORDER BY ${pinned}count DESC, 1
       LIMIT ${Math.max(size, 500)}
     ) x
     LEFT JOIN public."bvpzKodai" b ON b.code = x.code
     ${needle}
     ORDER BY x.count DESC, x.code
     LIMIT ${size}`,
    params.values,
  );
  return toFacetOptions(rows);
}
