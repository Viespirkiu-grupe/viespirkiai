// Postgres facetų pagalbininkai mažiems (iki kelių tūkst. eilučių) sąrašams —
// /neskelbiamos, /nepatikimi. Quickwit tokiems kiekiams neverta: `GROUP BY`
// per pilną lentelę trunka milisekundes, tad facetų skaičiai imami tiesiai iš PG.
//
// Facetų atranka gyvena tik URL'e — KARTOJAMAIS parametrais (`?isvada=A&isvada=B`),
// o ne kableliu atskirtu sąrašu: reikšmės čia yra laisvas tekstas (pvz. išvada
// „Sutikti, kad būtų vykdomos neskelbiamos derybos"), tad kablelis jas skaldytų.
import type { FacetOption } from './searchDokumentai.ts';
import { postgres } from '@/postgres/postgres.js';
import { createTtlPromiseCache } from '@/utils/ttlPromiseCache.js';

// Vienas sąrašo puslapis paleidžia 5–9 lygiagrečias užklausas, o naršyklės
// prefetch'as ar dvigubas užklausimas tą paketą pakartoja beveik tuo pačiu metu
// (loge — 3–4 kartus per 1–2 s su identiškais parametrais). Kešas sulieja
// vienu metu vykstančius vienodus krovimus į vieną.
const filtruotoKesas = createTtlPromiseCache(5_000);
// Nefiltruotas rodinys yra karštas kelias ir visiems vartotojams vienodas, o jo
// agregatai brangiausi (GROUP BY per visą lentelę), tad jam TTL ilgesnis.
const baziniKesas = createTtlPromiseCache(30_000);

/**
 * Sąrašo puslapio duomenų paketas su trumpu kešu. Raktas — pilnas URL su
 * paieškos parametrais, tad skirtingi filtrai/puslapiai nesimaišo.
 */
export function cachePageData<T>(url: URL, load: () => Promise<T>): Promise<T> {
  const kesas = url.search ? filtruotoKesas : baziniKesas;
  return kesas(url.pathname + url.search, load);
}

/**
 * Visos parametro reikšmės iš URL. Numatytai — kartojami parametrai; `sep`
 * nurodomas ten, kur formatas jau nusistovėjęs kitur (BVPŽ kodai — tarpais
 * skiriamas vienas laukas, bendras su BvpzPrefixField, žr. /sutartys).
 */
export function parseMultiParam(url: URL, param: string, sep?: string): string[] {
  const raw = sep
    ? (url.searchParams.get(param) ?? '').split(sep)
    : url.searchParams.getAll(param);
  return raw.map((value) => value.trim()).filter(Boolean);
}

/**
 * Tuščių parametrų nuvalymas prieš atvaizdavimą (GET forma pateikia ir tuščius
 * laukus). Grąžina nukreipimo kelią arba `null`, jei valyti nėra ko. Skirtingai
 * nuo bendro `cleanQuery`, išsaugo pasikartojančius parametrus.
 */
export function stripEmptyParams(url: URL): string | null {
  const kept = new URLSearchParams();
  let hasEmpty = false;
  for (const [key, value] of url.searchParams) {
    if (value === '') hasEmpty = true;
    else kept.append(key, value);
  }
  if (!hasEmpty) return null;
  const search = kept.toString();
  return url.pathname + (search ? `?${search}` : '');
}

/**
 * Numeruotų (`$1`, `$2`, …) parametrų rinkėjas. Kiekvienas `add` grąžina
 * vietaženklį ir įsimena reikšmę — taip sąlygos dėliojamos dalimis, o `values`
 * lieka tvarkingas pg masyvas.
 */
export class SqlParams {
  readonly values: unknown[] = [];

  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/**
 * Reikšmės perjungimo nuoroda facetui: prideda/pašalina reikšmę parametro
 * sąraše, atstato puslapį. Tuščia reikšmė („Visi") išvalo visą parametrą.
 */
export function makeFacetToggleUrl(
  url: URL,
  basePath: string,
  /** Parametrai, kurių reikšmės gyvena viename lauke su skirtuku (pvz. BVPŽ). */
  sepFor: (param: string) => string | undefined = () => undefined,
) {
  return (param: string, value: string): string => {
    const params = new URLSearchParams(url.search);
    const sep = sepFor(param);
    const current = parseMultiParam(url, param, sep);
    let next: string[];
    if (value === '') next = [];
    else if (current.includes(value)) next = current.filter((v) => v !== value);
    else next = [...current, value];

    params.delete(param);
    if (sep) {
      if (next.length) params.set(param, next.join(sep));
    } else {
      for (const item of next) params.append(param, item);
    }
    params.delete('page');

    const search = params.toString();
    return search ? `${basePath}?${search}` : basePath;
  };
}

/**
 * Paruošia DokFacetSection objektą: dabartinė atranka, matomos + perpildos
 * parinktys ir reikšmės perjungimo URL.
 *
 * Pažymėtos reikšmės visada eina pirmos ir NIEKADA nepakliūva į perpildą —
 * kitaip retas (pvz. 300-as pagal dažnį) pasirinktas pirkėjas dingtų už „Daugiau"
 * ir atrodytų, kad filtro nėra. Jei pažymėtų daugiau nei telpa, rodom jas visas.
 */
export function makeFacet(
  param: string,
  options: FacetOption[],
  selected: string[],
  toggleUrl: (param: string, value: string) => string,
  limit = 6,
) {
  const byValue = new Map(options.map((option) => [option.value, option]));
  // Pažymėtos reikšmės, kurių tarp parinkčių nėra (pvz. nulinis skaičius pagal
  // kitus filtrus), vis tiek rodomos — be skaičiaus.
  const chosen = selected.map((value) => byValue.get(value) ?? { value, count: null });
  const rest = options.filter((option) => !selected.includes(option.value));
  const room = Math.max(0, limit - chosen.length);

  return {
    filter: selected,
    visible: [...chosen, ...rest.slice(0, room)],
    hidden: rest.slice(room),
    toggleUrl: (value: string) => toggleUrl(param, value),
  };
}

/** `SELECT value, count[, label]` eilutes paverčia FacetOption sąrašu. */
export function toFacetOptions(
  rows: { value: unknown; count: unknown; label?: unknown; sub?: unknown }[],
): PgFacetOption[] {
  return rows
    .filter((row) => row.value != null && String(row.value) !== '')
    .map((row) => ({
      value: String(row.value),
      count: Number(row.count),
      ...(row.label != null && String(row.label) !== '' ? { label: String(row.label) } : {}),
      ...(row.sub != null && String(row.sub) !== '' ? { sub: String(row.sub) } : {}),
    }));
}

/**
 * FacetOption su papildoma antros eilutės žyma dialoge (pvz. pirkėjo JAR kodas,
 * kai pati facetų reikšmė yra pavadinimas). Juostoje `sub` nerodomas.
 */
export type PgFacetOption = FacetOption & { sub?: string };

/**
 * Papildo kodinius facetus (JAR kodus) įstaigų pavadinimais iš `jar` lentelės —
 * šaltinio lentelėse pavadinimo dažnai nėra, tad be šito juostoje kabo plikas
 * kodas. Nerasti kodai lieka be `label`.
 */
export async function attachJarNames(options: FacetOption[]): Promise<FacetOption[]> {
  const missing = options.filter((option) => !option.label).map((option) => option.value);
  if (!missing.length) return options;
  const { rows } = await postgres.query(
    'SELECT "jarKodas", pavadinimas FROM public.jar WHERE "jarKodas" = ANY($1)',
    [missing],
  );
  const names = new Map(rows.map((row: any) => [String(row.jarKodas), row.pavadinimas as string]));
  return options.map((option) =>
    option.label || !names.get(option.value)
      ? option
      : { ...option, label: names.get(option.value)! },
  );
}

/**
 * Sumų histogramos log-skalės kraštinės (€): ~5 žingsniai dekadai (1,2,3,5,7)
 * nuo 10 iki 100 mln. Tos pačios kaip /sutartys, kad slankiklis visur elgtųsi
 * vienodai. Paskutinis kaušas — „nuo 100 mln." (viskas virš).
 */
export const AMOUNT_EDGES: number[] = (() => {
  const edges = [0];
  for (let decade = 1; decade <= 8; decade++) {
    for (const step of [1, 2, 3, 5, 7]) {
      const value = step * 10 ** decade;
      if (value <= 100_000_000) edges.push(value);
    }
  }
  return edges;
})();

/**
 * `width_bucket(kaina, AMOUNT_EDGES)` eilučių pavertimas histogramos kaušais.
 * Domenas dinamiškas: nukerpam po ~1% masės iš abiejų galų (kad slankiklis
 * „priartėtų" prie ten, kur duomenys), bet paliekam bent 10 stulpelių.
 * Kraštinės rankenėlės reiškia „be ribos", tad išskirtys lieka pasiekiamos.
 */
export function buildAmountHistogram(rows: { idx: unknown; count: unknown }[]) {
  const counts = new Map(rows.map((row) => [Number(row.idx), Number(row.count)]));
  const all = AMOUNT_EDGES.map((from, i) => ({
    from,
    to: i + 1 < AMOUNT_EDGES.length ? AMOUNT_EDGES[i + 1] : null,
    // width_bucket grąžina 1, kai reikšmė patenka į [edges[0], edges[1]).
    count: counts.get(i + 1) ?? 0,
  }));

  const total = all.reduce((sum, bucket) => sum + bucket.count, 0);
  const last = AMOUNT_EDGES[AMOUNT_EDGES.length - 1];
  if (!total) return { buckets: [], domainMin: 0, domainMax: last };

  let start = 0;
  let end = all.length - 1;
  let cumulative = 0;
  for (let i = 0; i < all.length; i++) {
    cumulative += all[i].count;
    if (cumulative > total * 0.01) { start = i; break; }
  }
  cumulative = 0;
  for (let i = 0; i < all.length; i++) {
    cumulative += all[i].count;
    if (cumulative >= total * 0.99) { end = i; break; }
  }
  if (end < start) end = start;

  const MIN_BARS = 10;
  while (end - start + 1 < MIN_BARS && (start > 0 || end < all.length - 1)) {
    if (start > 0) start--;
    if (end - start + 1 < MIN_BARS && end < all.length - 1) end++;
  }

  const buckets = all.slice(start, end + 1);
  return {
    buckets,
    domainMin: buckets[0].from,
    domainMax: buckets[buckets.length - 1].to ?? last,
  };
}

const MONTH_TARGET_BARS = 36;

/**
 * Mėnesinių `GROUP BY date_trunc('month', …)` eilučių pavertimas histogramos
 * kaušais slankikliui: užpildo tuščius mėnesius, nukerpa tuščius galus ir
 * adaptyviai sujungia gretimus kaušus (ketvirtis, pusmetis, metai…), kad liktų
 * iki ~36 stulpelių. `from`/`to` — epoch millis (kaip laukia HistogramRangeFilter).
 */
export function buildMonthHistogram(rows: { bucket: unknown; count: unknown }[]) {
  const parsed = rows
    .map((row) => ({ ms: Date.parse(`${String(row.bucket).slice(0, 10)}T00:00:00Z`), count: Number(row.count) }))
    .filter((row) => Number.isFinite(row.ms))
    .sort((a, b) => a.ms - b.ms);

  const now = Date.now();
  if (!parsed.length) return { buckets: [], domainMin: now - 365 * 86_400_000, domainMax: now };

  // Ištisinė mėnesių eilutė nuo pirmo iki paskutinio (tušti mėnesiai — 0).
  const counts = new Map(parsed.map((row) => [row.ms, row.count]));
  const start = new Date(parsed[0].ms);
  const end = new Date(parsed[parsed.length - 1].ms);
  const months: { from: number; to: number; count: number }[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor.getTime() <= end.getTime()) {
    const from = cursor.getTime();
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    months.push({ from, to: cursor.getTime(), count: counts.get(from) ?? 0 });
  }

  let group = 1;
  for (const size of [1, 3, 6, 12, 24, 60]) {
    group = size;
    if (Math.ceil(months.length / size) <= MONTH_TARGET_BARS) break;
  }

  const buckets: { from: number; to: number; count: number }[] = [];
  for (let i = 0; i < months.length; i += group) {
    const chunk = months.slice(i, i + group);
    buckets.push({
      from: chunk[0].from,
      to: chunk[chunk.length - 1].to,
      count: chunk.reduce((sum, month) => sum + month.count, 0),
    });
  }

  return {
    buckets,
    domainMin: buckets[0].from,
    domainMax: buckets[buckets.length - 1].to,
  };
}
