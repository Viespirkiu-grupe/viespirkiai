/*
Teismo sprendimų tarpinstancinė statistika iš Quickwit `documents_*` indekso.

Skaičiuojam ne iš Postgres, o iš paieškos indekso: ten abu šaltiniai (senasis
LITEKO ir LITEKO2) jau suvesti į vieną `type:teismoNuosprendis` rinkinį su
vienodais `metadata.*` laukais, tad viena agregacija apima visus 2.25 mln.
sprendimų per kelias sekundes.

Ašis, ant kurios viskas laikosi — `metadata.teisminisProcesoNr`. Bylai keliaujant
per instancijas jis nekinta, tad juo sprendimai suvedami į vieną teisminį procesą
(žr. modules/liteko/nuosprendisPagalUuid.js gautiSusijusiusSprendimus).
*/

import { searchIndexPattern as qwSearch } from '@/quickwit/qwHttp.js';
import { createTtlPromiseCache } from '@/utils/ttlPromiseCache.js';

/** qwHttp.js grąžina netipizuotą Quickwit atsakymą – laukus skaitom patys. */
const searchIndexPattern = qwSearch as (pattern: string, body: unknown) => Promise<any>;

const INDEX_PATTERN = 'documents_*';
const BAZINE_UZKLAUSA = 'type:teismoNuosprendis';

/** Quickwit `datetime` intervalų ribos šiam laukui paduodamos nanosekundėmis. */
const MS_I_NS = 1_000_000;

/** Range agregacija prideda ir atvirus „*-…“ kibirus – paliekam tik metus. */
const METAI = /^\d{4}$/;

/** Terms agregacijos kibirų riba Quickwit'e — 65 000; laikomės saugiu atstumu. */
const KIBIRU_RIBA = 60_000;

/**
 * Nuo kelių sprendimų procese pradedam tikslų skirstinį. Mažesnę ribą Quickwit
 * atmestų (per daug kibirų), tad einam nuo mažiausios ir keliam, kol telpa.
 */
const SKIRSTINIO_RIBOS = [3, 4, 5, 6];

/** Statistika brangi (~4 s), o kinta kartą per parą — laikom procese valandą. */
const cache = createTtlPromiseCache(60 * 60 * 1000);

/** Tvarkingas teisminio proceso nr.: `2-55-3-00930-2013-3`. */
const PROCESO_NR = /^\d-\d{2}-\d-\d{5}-\d{4}-\d$/;

/** Formaliai taisyklingas, bet tuščias numeris – LITEKO užpildas. */
const TUSCIAS_NR = /^[0-]+$/;

export interface Kibiras {
  reiksme: string;
  kiekis: number;
}

export interface InstancijosEilute {
  instancija: string;
  sprendimai: number;
  procesai: number;
  sprendimuProcese: number;
  /** Kokią dalį visų teisminių procesų ši instancija palietė, procentais. */
  daliesProcentai: number;
}

export interface ProcesoEilute {
  procesoNr: string;
  sprendimai: number;
}

export interface SkirstinioEilute {
  etikete: string;
  procesai: number;
  /** `true`, kai reikšmė išvesta iš apytikslio unikalių procesų skaičiaus. */
  apytiksliai: boolean;
}

export interface NuosprendziuStatistika {
  sprendimai: number;
  procesai: number;
  sprendimuProcese: number;
  /** Nuo kelių sprendimų procese skirstinys tikslus. */
  skirstinioRiba: number;
  skirstinys: SkirstinioEilute[];
  daugiausiaiSprendimu: ProcesoEilute[];
  instancijos: InstancijosEilute[];
  teismai: Kibiras[];
  bylosRusys: Kibiras[];
  saltiniai: Kibiras[];
  metai: Kibiras[];
  /** Kiek užtruko Quickwit užklausos (ms). */
  trukmeMs: number;
}

function kibirai(agg: any): Kibiras[] {
  return (agg?.buckets ?? [])
    .map((b: any) => ({ reiksme: String(b.key ?? ''), kiekis: Number(b.doc_count ?? 0) }))
    .filter((b: Kibiras) => b.reiksme && b.kiekis > 0);
}

/** Kalendorinių metų rėžiai — `date_histogram` fixed_interval slenka per metus. */
function metuRezai(nuo: number, iki: number) {
  const ranges = [];
  for (let metai = nuo; metai <= iki; metai += 1) {
    ranges.push({
      key: String(metai),
      from: Date.UTC(metai, 0, 1) * MS_I_NS,
      to: Date.UTC(metai + 1, 0, 1) * MS_I_NS,
    });
  }
  return ranges;
}

/**
 * Procesų, turinčių bent `riba` sprendimų, kibirai. Quickwit terms agregacija
 * turi kietą kibirų limitą, tad ribą keliam tol, kol atsakymas telpa.
 */
async function sprendimuSkaiciai(): Promise<{ riba: number; kibirai: any[] }> {
  let paskutineKlaida: unknown = null;
  for (const riba of SKIRSTINIO_RIBOS) {
    try {
      const data = await searchIndexPattern(INDEX_PATTERN, {
        query: BAZINE_UZKLAUSA,
        max_hits: 0,
        aggs: {
          procesai: {
            terms: {
              field: 'metadata.teisminisProcesoNr',
              size: KIBIRU_RIBA,
              shard_size: KIBIRU_RIBA * 2,
              min_doc_count: riba,
            },
          },
        },
        format: 'json',
      });
      const buckets = data?.aggregations?.procesai?.buckets ?? [];
      // Atsimušus į `size` skirstinys būtų nupjautas – bandom aukštesnę ribą.
      if (buckets.length < KIBIRU_RIBA) return { riba, kibirai: buckets };
    } catch (cause) {
      paskutineKlaida = cause;
    }
  }
  if (paskutineKlaida) throw paskutineKlaida;
  return { riba: SKIRSTINIO_RIBOS[SKIRSTINIO_RIBOS.length - 1], kibirai: [] };
}

/** Unikalių teisminių procesų skaičius su papildomu filtru (HLL++, apytikslis). */
async function procesuSkaicius(filtras?: string): Promise<number> {
  const data = await searchIndexPattern(INDEX_PATTERN, {
    query: filtras ? `${BAZINE_UZKLAUSA} AND ${filtras}` : BAZINE_UZKLAUSA,
    max_hits: 0,
    aggs: { procesai: { cardinality: { field: 'metadata.teisminisProcesoNr' } } },
    format: 'json',
  });
  return Math.round(Number(data?.aggregations?.procesai?.value ?? 0));
}

/** Sprendimų skirstinys pagal sprendimų skaičių procese. */
function sudarytiSkirstini(buckets: any[], riba: number, procesai: number): SkirstinioEilute[] {
  const pagalKieki = new Map<number, number>();
  for (const b of buckets) {
    const n = Number(b.doc_count ?? 0);
    pagalKieki.set(n, (pagalKieki.get(n) ?? 0) + 1);
  }
  const tarp = (nuo: number, iki: number) => {
    let suma = 0;
    for (const [n, kiek] of pagalKieki) if (n >= nuo && n <= iki) suma += kiek;
    return suma;
  };

  const virsRibos = buckets.length;
  const eilutes: SkirstinioEilute[] = [
    {
      etikete: riba === 3 ? '1–2' : `1–${riba - 1}`,
      procesai: Math.max(0, procesai - virsRibos),
      apytiksliai: true,
    },
  ];
  // Nuo ribos – tikslūs kibirai; viršūnę sutraukiam, kad eilučių liktų kelios.
  for (let n = riba; n < 6; n += 1) {
    eilutes.push({ etikete: String(n), procesai: tarp(n, n), apytiksliai: false });
  }
  eilutes.push({ etikete: '6–10', procesai: tarp(6, 10), apytiksliai: false });
  eilutes.push({ etikete: '11–20', procesai: tarp(11, 20), apytiksliai: false });
  eilutes.push({ etikete: '21+', procesai: tarp(21, Number.MAX_SAFE_INTEGER), apytiksliai: false });
  return eilutes.filter((e) => e.procesai > 0);
}

async function skaiciuoti(): Promise<NuosprendziuStatistika> {
  const pradzia = Date.now();
  const siemet = new Date().getUTCFullYear();

  const [bendra, skaiciai] = await Promise.all([
    searchIndexPattern(INDEX_PATTERN, {
      query: BAZINE_UZKLAUSA,
      max_hits: 0,
      aggs: {
        procesai: { cardinality: { field: 'metadata.teisminisProcesoNr' } },
        instancijos: { terms: { field: 'metadata.instancija', size: 20 } },
        teismai: { terms: { field: 'metadata.teismas', size: 20 } },
        bylosRusys: { terms: { field: 'metadata.bylosRusis', size: 20 } },
        saltiniai: { terms: { field: 'source', size: 10 } },
        metai: { range: { field: 'happenedAt', ranges: metuRezai(2000, siemet) } },
      },
      format: 'json',
    }),
    sprendimuSkaiciai(),
  ]);

  const sprendimai = Number(bendra?.num_hits ?? 0);
  const procesai = Math.round(Number(bendra?.aggregations?.procesai?.value ?? 0));
  const instancijuKibirai = kibirai(bendra?.aggregations?.instancijos);

  // Unikalūs procesai kiekvienoje instancijoje – po užklausą kiekvienai reikšmei
  // (cardinality kaip terms subagregacija Quickwit'e nepalaikoma).
  const instancijuProcesai = await Promise.all(
    instancijuKibirai.map((k) =>
      procesuSkaicius(`metadata.instancija:"${k.reiksme.replace(/"/g, '')}"`),
    ),
  );

  // Dalį skaičiuojam nuo visų procesų: „instancijos pasiekiamumas". Instancijų
  // sumuoti negalima – tas pats procesas patenka į kelias.
  const instancijos: InstancijosEilute[] = instancijuKibirai.map((k, i) => ({
    instancija: k.reiksme,
    sprendimai: k.kiekis,
    procesai: instancijuProcesai[i],
    sprendimuProcese: instancijuProcesai[i] ? k.kiekis / instancijuProcesai[i] : 0,
    daliesProcentai: procesai ? (instancijuProcesai[i] / procesai) * 100 : 0,
  }));

  const daugiausiaiSprendimu: ProcesoEilute[] = skaiciai.kibirai
    // Šaltiniuose pasitaiko sugadintų numerių („1-", „0-00-0-00000-0000-0"),
    // kurie surenka tūkstančius nesusijusių sprendimų – jie ne procesai.
    .filter((b: any) => PROCESO_NR.test(String(b.key ?? '')) && !TUSCIAS_NR.test(String(b.key)))
    .slice(0, 15)
    .map((b: any) => ({ procesoNr: String(b.key), sprendimai: Number(b.doc_count ?? 0) }));

  return {
    sprendimai,
    procesai,
    sprendimuProcese: procesai ? sprendimai / procesai : 0,
    skirstinioRiba: skaiciai.riba,
    skirstinys: sudarytiSkirstini(skaiciai.kibirai, skaiciai.riba, procesai),
    daugiausiaiSprendimu,
    instancijos,
    teismai: kibirai(bendra?.aggregations?.teismai),
    bylosRusys: kibirai(bendra?.aggregations?.bylosRusys),
    saltiniai: kibirai(bendra?.aggregations?.saltiniai),
    metai: kibirai(bendra?.aggregations?.metai).filter((m) => METAI.test(m.reiksme)),
    trukmeMs: Date.now() - pradzia,
  };
}

/** Teismo sprendimų statistika (kešuojama valandai). */
export function gautiNuosprendziuStatistika(): Promise<NuosprendziuStatistika> {
  return cache('teismoNuosprendziai', skaiciuoti);
}
