import { postgres } from '@/postgres/postgres.js';
import { searchIndexPattern } from '@/quickwit/qwHttp.js';
import { SQL_LOG_INDEX_PATTERN } from '@/quickwit/sqlLogIngest.js';

/**
 * Duomenys `/statistika/sql` puslapiui.
 *
 * Skaičiai imami iš Quickwit (`sqlLogV2_*`), o užklausų tekstai – iš Postgres
 * lentelės `sqlLogTekstai`: Quickwit'e saugomas tik `md5`.
 *
 * Skirtingų užklausų formų yra keli šimtai, tad `terms` agregacija paimama
 * visa (iki `MAX_FORMU`) ir rikiuojama JS pusėje — taip nepriklausom nuo to, ar
 * Quickwit versija moka rikiuoti pagal sub-agregaciją.
 *
 * Visos trukmės skaičiuojamos TIK iš `queued = false` įrašų: kai pool'as pilnas,
 * į `ms` įskaičiuotas laukimas laisvos jungties, tad tokios reikšmės matuoja
 * apkrovą, o ne pačios užklausos kainą, ir smarkiai iškreipia p95/p99 bei
 * vidurkį. Laukusių eilėje kiekis rodomas atskirai (`laukeEileje`).
 */

const MAX_FORMU = 1_000;

/** Filtras „be laukusių eilėje“. Seni įrašai `queued` lauko neturi – juos įskaitom. */
const BE_EILES = 'NOT queued:true';
const TIK_EILE = 'queued:true';

/** `op` reikšmės → Badge variantas (kad spalvos abiejuose puslapiuose sutaptų). */
export const OP_VARIANTAI: Record<string, "default" | "primary" | "success" | "warning" | "danger" | "info" | "muted"> = {
  select: "info",
  insert: "success",
  update: "warning",
  delete: "danger",
  schema: "muted",
  tx: "muted",
  other: "default",
};

/** Trukmė žmonėms: 340 ms / 1,25 s / 3,4 min. */
export function formatuotiMs(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 60_000) return `${(v / 60_000).toLocaleString("lt-LT", { maximumFractionDigits: 1 })} min`;
  if (v >= 1_000) return `${(v / 1_000).toLocaleString("lt-LT", { maximumFractionDigits: 2 })} s`;
  return `${v.toLocaleString("lt-LT", { maximumFractionDigits: 1 })} ms`;
}

export function trumpinti(tekstas: string, ilgis = 170): string {
  return tekstas.length > ilgis ? `${tekstas.slice(0, ilgis)}…` : tekstas;
}

export interface Laikotarpis {
  raktas: string;
  label: string;
  sekundes: number;
}

export const LAIKOTARPIAI: Laikotarpis[] = [
  { raktas: '1h', label: 'Paskutinė valanda', sekundes: 3_600 },
  { raktas: '6h', label: 'Paskutinės 6 val.', sekundes: 21_600 },
  { raktas: '24h', label: 'Paskutinė para', sekundes: 86_400 },
  { raktas: '7d', label: 'Paskutinės 7 d.', sekundes: 604_800 },
  { raktas: '30d', label: 'Paskutinės 30 d.', sekundes: 2_592_000 },
];

export const NUMATYTAS_LAIKOTARPIS = '24h';

export function parseLaikotarpis(raktas: string | undefined): Laikotarpis {
  return (
    LAIKOTARPIAI.find((l) => l.raktas === raktas) ??
    LAIKOTARPIAI.find((l) => l.raktas === NUMATYTAS_LAIKOTARPIS)!
  );
}

export interface UzklausosEilute {
  md5: string;
  op: string | null;
  kiekis: number;
  visoMs: number;
  vidMs: number;
  maksMs: number;
  klaidos: number;
  sql: string | null;
}

export interface Detales {
  md5: string;
  sql: string | null;
  op: string | null;
  kiekis: number;
  visoMs: number;
  vidMs: number;
  maksMs: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  klaidos: number;
  laukeEileje: number;
  pagalRole: { reiksme: string; kiekis: number }[];
  pagalHost: { reiksme: string; kiekis: number }[];
  pagalEnv: { reiksme: string; kiekis: number }[];
  histograma: { nuo: number; kiekis: number; visoMs: number }[];
  zingsnisTekstas: string;
}

const skaicius = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function laikoRezis(laikotarpis: Laikotarpis) {
  const iki = Math.floor(Date.now() / 1000);
  return { start_timestamp: iki - laikotarpis.sekundes, end_timestamp: iki };
}

/** Histogramos žingsnis: ~40 stulpelių pasirinktam rėžiui. */
function zingsnis(laikotarpis: Laikotarpis): { sekundes: number; tekstas: string; zmogui: string } {
  const variantai = [10, 30, 60, 300, 900, 1_800, 3_600, 10_800, 21_600, 86_400];
  const norimas = laikotarpis.sekundes / 40;
  const s = variantai.find((v) => v >= norimas) ?? variantai[variantai.length - 1];
  const zmogui = s >= 86_400 ? `${s / 86_400} d.` : s >= 3_600 ? `${s / 3_600} val.` : s >= 60 ? `${s / 60} min.` : `${s} s`;
  return { sekundes: s, tekstas: `${s}s`, zmogui };
}

/**
 * Užklausų tekstai iš Postgres. Jei lentelės dar nėra – grąžinam tuščią žemėlapį,
 * puslapis tada rodo tik `md5` (ir pasako, kodėl).
 */
async function gautiTekstus(md5ai: string[]): Promise<Map<string, string>> {
  if (!md5ai.length) return new Map();
  try {
    const { rows } = await postgres.query(
      'SELECT "md5", "sql" FROM dba."sqlLogTekstai" WHERE "md5" = ANY($1)',
      [md5ai],
    );
    return new Map(rows.map((r: any) => [String(r.md5), String(r.sql)]));
  } catch (err: any) {
    if (err?.code === '42P01') return new Map();
    throw err;
  }
}

/** Ar `sqlLogTekstai` lentelė apskritai egzistuoja (žinutei puslapyje). */
export async function arYraTekstuLentele(): Promise<boolean> {
  const { rows } = await postgres.query(
    `SELECT to_regclass('dba."sqlLogTekstai"') IS NOT NULL AS yra`,
  );
  return rows[0]?.yra === true;
}

/** Brangiausios užklausų formos – rikiuota pagal bendrą laiką (dažnis × trukmė). */
export async function brangiausiosUzklausos(
  laikotarpis: Laikotarpis,
  limit = 100,
): Promise<{
  eilutes: UzklausosEilute[];
  visoUzklausu: number;
  visoMs: number;
  formuIsViso: number;
  laukeEileje: number;
}> {
  const rezis = laikoRezis(laikotarpis);
  const [atsakymas, eileje]: any[] = await Promise.all([
    searchIndexPattern(SQL_LOG_INDEX_PATTERN, {
      query: BE_EILES,
      max_hits: 0,
      ...rezis,
      aggs: {
        formos: {
          terms: { field: 'md5', size: MAX_FORMU },
          aggs: {
            visoMs: { sum: { field: 'ms' } },
            vidMs: { avg: { field: 'ms' } },
            maksMs: { max: { field: 'ms' } },
            op: { terms: { field: 'op', size: 1 } },
            klaidos: { terms: { field: 'ok', size: 2 } },
          },
        },
      },
    }),
    searchIndexPattern(SQL_LOG_INDEX_PATTERN, { query: TIK_EILE, max_hits: 0, ...rezis }),
  ]);

  const kausai = atsakymas?.aggregations?.formos?.buckets ?? [];
  const visos: UzklausosEilute[] = kausai.map((b: any) => ({
    md5: String(b.key),
    op: b.op?.buckets?.[0]?.key != null ? String(b.op.buckets[0].key) : null,
    kiekis: skaicius(b.doc_count),
    visoMs: skaicius(b.visoMs?.value),
    vidMs: skaicius(b.vidMs?.value),
    maksMs: skaicius(b.maksMs?.value),
    klaidos: skaicius(
      (b.klaidos?.buckets ?? []).find((x: any) => x.key === 0 || x.key === false)?.doc_count,
    ),
    sql: null,
  }));

  visos.sort((a, b) => b.visoMs - a.visoMs);
  const eilutes = visos.slice(0, limit);

  const tekstai = await gautiTekstus(eilutes.map((e) => e.md5));
  for (const eilute of eilutes) eilute.sql = tekstai.get(eilute.md5) ?? null;

  return {
    eilutes,
    visoUzklausu: visos.reduce((s, e) => s + e.kiekis, 0),
    visoMs: visos.reduce((s, e) => s + e.visoMs, 0),
    formuIsViso: visos.length,
    laukeEileje: skaicius(eileje?.num_hits),
  };
}

/** Vienos formos pjūvis: statistika, pasiskirstymai ir laiko histograma. */
export async function uzklausosDetales(
  md5: string,
  laikotarpis: Laikotarpis,
): Promise<Detales | null> {
  const zings = zingsnis(laikotarpis);
  const forma = `md5:"${md5.replace(/"/g, '')}"`;
  const rezis = laikoRezis(laikotarpis);
  const [atsakymas, eileje]: any[] = await Promise.all([
    searchIndexPattern(SQL_LOG_INDEX_PATTERN, {
      query: `${forma} AND ${BE_EILES}`,
      max_hits: 0,
      ...rezis,
      aggs: {
        visoMs: { sum: { field: 'ms' } },
        vidMs: { avg: { field: 'ms' } },
        maksMs: { max: { field: 'ms' } },
        percentiliai: { percentiles: { field: 'ms', percents: [50, 95, 99] } },
        op: { terms: { field: 'op', size: 1 } },
        role: { terms: { field: 'role', size: 10 } },
        host: { terms: { field: 'host', size: 10 } },
        env: { terms: { field: 'env', size: 5 } },
        ok: { terms: { field: 'ok', size: 2 } },
        laike: {
          date_histogram: { field: 'ts', fixed_interval: zings.tekstas },
          aggs: { visoMs: { sum: { field: 'ms' } } },
        },
      },
    }),
    searchIndexPattern(SQL_LOG_INDEX_PATTERN, {
      query: `${forma} AND ${TIK_EILE}`,
      max_hits: 0,
      ...rezis,
    }),
  ]);

  const kiekis = skaicius(atsakymas?.num_hits);
  const laukeEileje = skaicius(eileje?.num_hits);
  if (!kiekis && !laukeEileje) return null;

  const a = atsakymas.aggregations ?? {};
  const kausaiKaip = (agg: any) =>
    (agg?.buckets ?? []).map((b: any) => ({
      reiksme: String(b.key),
      kiekis: skaicius(b.doc_count),
    }));
  const percentilis = (p: string) => {
    const v = a.percentiliai?.values?.[p] ?? a.percentiliai?.values?.[`${p}.0`];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const tekstai = await gautiTekstus([md5]);

  return {
    md5,
    sql: tekstai.get(md5) ?? null,
    op: a.op?.buckets?.[0]?.key != null ? String(a.op.buckets[0].key) : null,
    kiekis,
    visoMs: skaicius(a.visoMs?.value),
    vidMs: skaicius(a.vidMs?.value),
    maksMs: skaicius(a.maksMs?.value),
    p50: percentilis('50'),
    p95: percentilis('95'),
    p99: percentilis('99'),
    klaidos: skaicius(
      (a.ok?.buckets ?? []).find((x: any) => x.key === 0 || x.key === false)?.doc_count,
    ),
    laukeEileje,
    pagalRole: kausaiKaip(a.role),
    pagalHost: kausaiKaip(a.host),
    pagalEnv: kausaiKaip(a.env),
    histograma: (a.laike?.buckets ?? []).map((b: any) => ({
      nuo: skaicius(b.key),
      kiekis: skaicius(b.doc_count),
      visoMs: skaicius(b.visoMs?.value),
    })),
    zingsnisTekstas: zings.zmogui,
  };
}
