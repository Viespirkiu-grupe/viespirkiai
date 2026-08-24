/**
 * `/duomenys/lenteles` rodymo pagalbinės funkcijos.
 */

const REPO = 'https://github.com/Viespirkiu-grupe/viespirkiai';

/** Nuoroda į failą repozitorijoje. `src/pages/kodas.ts` veda tik į šaknį. */
export function kodoNuoroda(kelias: string): string {
  return `${REPO}/blob/main/${kelias.replace(/^\/+/, '')}`;
}

const DYDZIO_VIENETAI = ['B', 'kB', 'MB', 'GB', 'TB'];

/** Dydis baitais žmonėms. `utils/units.js` fmtBytes sustoja ties MiB. */
export function dydis(baitai: number): string {
  if (!Number.isFinite(baitai) || baitai <= 0) return '—';

  let reiksme = baitai;
  let laipsnis = 0;
  while (reiksme >= 1024 && laipsnis < DYDZIO_VIENETAI.length - 1) {
    reiksme /= 1024;
    laipsnis += 1;
  }

  const tikslumas = reiksme >= 100 || laipsnis === 0 ? 0 : 1;
  const skaicius = reiksme.toLocaleString('lt-LT', { maximumFractionDigits: tikslumas });
  // Nelauzomas tarpas: „88,5 MB“ neturi lauztis per dvi eilutes nei lenteleje,
  // nei kortelese, kur `cell-nowrap` netaikomas.
  return `${skaicius}\u00a0${DYDZIO_VIENETAI[laipsnis]}`;
}

/** Eilučių kiekis. Visada apytikslis – tai `n_live_tup`, ne `COUNT(*)`. */
export function eiluciuKiekis(kiekis: number): string {
  if (!Number.isFinite(kiekis) || kiekis <= 0) return '0';
  return Math.round(kiekis).toLocaleString('lt-LT');
}

/** Ilgi katalogo tipų vardai į trumpus, kad stulpelių lentelė nesiplėstų. */
const TIPU_TRUMPINIAI: Record<string, string> = {
  'character varying': 'varchar',
  'character': 'char',
  'timestamp without time zone': 'timestamp',
  'timestamp with time zone': 'timestamptz',
  'time without time zone': 'time',
  'time with time zone': 'timetz',
  'double precision': 'float8',
  'boolean': 'bool',
  'integer': 'int4',
  'bigint': 'int8',
  'smallint': 'int2',
};

export function trumpasTipas(tipas: string): string {
  for (const [ilgas, trumpas] of Object.entries(TIPU_TRUMPINIAI)) {
    if (tipas === ilgas) return trumpas;
    if (tipas.startsWith(`${ilgas}(`)) return `${trumpas}${tipas.slice(ilgas.length)}`;
    if (tipas === `${ilgas}[]`) return `${trumpas}[]`;
  }
  return tipas;
}

/** Ribojimo tipo raidė į lietuvišką pavadinimą. */
export function ribojimoPavadinimas(tipas: string): string {
  return {
    p: 'Pirminis raktas',
    u: 'Unikalus',
    f: 'Išorinis raktas',
    c: 'Tikrinimas',
    x: 'Exclusion',
    t: 'Trigeris',
  }[tipas] ?? tipas;
}

/** Dalis procentais, pvz. aprašytų lentelių rodikliui. */
export function dalis(dalis_: number, visuma: number): string {
  if (!visuma) return '—';
  return `${Math.round((dalis_ / visuma) * 100)} %`;
}

/** `public.x` → `x`; kitos schemos rodomos su prefiksu. */
export function rodomasVardas(schema: string, vardas: string): string {
  return schema === 'public' ? vardas : `${schema}.${vardas}`;
}
