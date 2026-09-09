/**
 * `/duomenys/lenteles` duomenų modelio tipai.
 *
 * Modelis daugiaschemis (`schema` + `lentele` raktas): schema ir yra rodymo
 * grupė, o `public` teliko PostGIS `spatial_ref_sys`.
 */

/** Lentelės raktas visame modelyje: `schema.lentele`. */
export type LentelesRaktas = string;

export interface Stulpelis {
  vardas: string;
  tipas: string;
  arButinas: boolean;
  numatytoji: string | null;
  generuota: boolean;
  aprasymas: string | null;
  arPirminis: boolean;
  /** Į kurią lentelę rodo, jei stulpelis dalyvauja FK. */
  isorinisRaktas: LentelesRaktas | null;
}

export interface Ribojimas {
  vardas: string;
  /** `p` pirminis, `u` unikalus, `f` išorinis, `c` tikrinimo, `x` exclusion. */
  tipas: string;
  apibrezimas: string;
  /** Tik FK atveju. */
  rodoI: LentelesRaktas | null;
  stulpeliai: string[];
  isoriniaiStulpeliai: string[];
}

export interface Indeksas {
  vardas: string;
  apibrezimas: string;
  arPirminis: boolean;
  dydis: number;
}

export interface Trigeris {
  vardas: string;
  apibrezimas: string;
}

/**
 * Schema kaip rodymo vienetas. `aprasymas` ateina iš `COMMENT ON SCHEMA`,
 * likusieji laukai – iš `dba."schemos"`; jos įrašo nesant, `pavadinimas` yra
 * pats schemos vardas.
 */
export interface Schema {
  vardas: string;
  pavadinimas: string;
  aprasymas: string | null;
  saltinis: string | null;
  saltinioUrl: string | null;
  tvarka: number;
}

/** Rankiniai metaduomenys iš `dba."lenteles"`. */
export interface LentelesMeta {
  saltinis: string | null;
  saltinioUrl: string | null;
  atnaujinimoBudas: string | null;
  busena: string | null;
  uzduotys: string[];
  moduliai: string[];
  komandos: string[];
  atnaujinimoDaznis: string | null;
  pastabos: string | null;
}

export interface Lentele {
  raktas: LentelesRaktas;
  schema: string;
  vardas: string;
  aprasymas: string | null;
  stulpeliai: Stulpelis[];
  ribojimai: Ribojimas[];
  indeksai: Indeksas[];
  trigeriai: Trigeris[];
  /** Baitai. */
  duomenuDydis: number;
  indeksuDydis: number;
  bendrasDydis: number;
  /** ANALYZE įvertis, ne tikslus COUNT(*). */
  eiluciuIvertis: number;
  meta: LentelesMeta | null;
}

export interface Rysys {
  is: LentelesRaktas;
  i: LentelesRaktas;
  vardas: string;
  stulpeliai: string[];
  isoriniaiStulpeliai: string[];
}

export interface Metrikos {
  lenteliu: number;
  stulpeliu: number;
  isoriniuRaktu: number;
  bendrasDydis: number;
  eiluciuIvertis: number;
  aprasytaLenteliu: number;
  aprasytaStulpeliu: number;
  schemu: number;
}

export interface SchemosModelis {
  lenteles: Lentele[];
  /** Greitas priėjimas pagal `schema.lentele`. */
  pagalRakta: Map<LentelesRaktas, Lentele>;
  /** Tik tos schemos, kuriose realiai yra bent viena lentelė; rikiuota `tvarka`. */
  schemos: Schema[];
  schemosPagalVarda: Map<string, Schema>;
  rysiai: Rysys[];
  metrikos: Metrikos;
  sudaryta: string;
  /** Klaida, jei `dba` schema dar nepritaikyta – puslapis vis tiek veikia. */
  metaKlaida: string | null;
}
