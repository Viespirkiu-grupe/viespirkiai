// Serverinis /teisesAktas/[id]/palyginimas[/:a[/:b]] kontroleris.
//
// Redakcijos renkamos SPAUDŽIANT, ne vedant datas: kairėje pasirenkama senesnė
// (`:a`), dešinėje naujesnė (`:b`), abi eina į adresą, tad kiekvienas žingsnis
// turi savo nuorodą ir viskas veikia be JS.
//
// Skirtumus skaičiuoja tas pats branduolys kaip ir CLI
// (`modules/teisekura/redakcijuSkirtumai.js`).
import { postgres } from '@/postgres/postgres.js';
import {
  daliesEilutes,
  ikeltiRedakcija,
  lenteliuPriesagas,
  palygintiStruktura,
  redakcijuSarasas,
  suskaiciuoti,
} from '@/modules/teisekura/redakcijuSkirtumai.js';

export interface RedakcijosEilute {
  editionToken: string;
  nuo: string;
  iki: string | null;
  url: string | null;
  turiTeksta: boolean;
}

export interface Segmentas {
  tipas: 'lygu' | 'pridėta' | 'pašalinta';
  tekstas: string;
}

export interface SkirtumoEilute {
  tipas: 'pakeista' | 'pridėta' | 'pašalinta';
  tekstas?: string;
  segmentai?: Segmentas[];
}

export interface Pakeitimas {
  partId: string;
  pavadinimas: string;
  pakopos: string[];
  pokytis: 'pakeista' | 'pridėta' | 'pašalinta';
  eilutes: SkirtumoEilute[];
}

/**
 * Kelias iki dalies: viršutinė „Pagrindinė dalis <AKTO PAVADINIMAS>“ pakopa
 * nieko nepasako (ji ta pati visoms dalims), o iš gilaus kodekso naudotojui
 * pakanka artimiausių pakopų.
 */
function trumpintiPakopas(pakopos: string[]): string[] {
  const be = pakopos.filter(p => !/^pagrindin(ė|e) dalis/i.test(p.trim()));
  return be.length > 3 ? ['…', ...be.slice(-3)] : be;
}

export function laikotarpis(r: RedakcijosEilute): string {
  return r.iki ? `${r.nuo} → ${r.iki}` : `nuo ${r.nuo}`;
}

/** Palyginimo adresas: /teisesAktas/:id/palyginimas[/:a[/:b]]. */
export function palyginimoKelias(
  legalActId: string,
  a?: string | null,
  b?: string | null,
): string {
  const dalys = [`/teisesAktas/${encodeURIComponent(legalActId)}/palyginimas`];
  if (a) dalys.push(encodeURIComponent(a));
  if (a && b) dalys.push(encodeURIComponent(b));
  return dalys.join('/');
}

export interface PalyginimoDuomenys {
  act: { legalActId: string; title: string | null };
  pavadinimas: string;
  /** Naujausios viršuje – ta pačia tvarka kaip akto redakcijų meniu. */
  redakcijos: RedakcijosEilute[];
  a: RedakcijosEilute | null;
  b: RedakcijosEilute | null;
  klaida: string | null;
  suvestine: { pakeista: number; 'pridėta': number; 'pašalinta': number } | null;
  pakeitimai: Pakeitimas[];
}

/**
 * @param aKey senesnės redakcijos tokenas iš kelio, @param bKey naujesnės.
 *   Nė vienas nėra privalomas – be jų puslapis tik siūlo rinktis ir nieko
 *   nelygina. Netinkamas ar ne naujesnis `b` tyliai numetamas.
 */
export async function loadPalyginimas(
  legalActId: string,
  aKey?: string,
  bKey?: string,
): Promise<PalyginimoDuomenys | null> {
  const { rows: actRows } = await postgres.query(
    `SELECT "legalActId", "title" FROM "eTarLegalAct" WHERE "legalActId" = $1`,
    [legalActId],
  );
  const act = actRows[0];
  if (!act) return null;

  const redakcijos: RedakcijosEilute[] = await redakcijuSarasas(legalActId);
  const galimos = redakcijos.filter(r => r.turiTeksta);

  const a = (aKey && galimos.find(r => r.editionToken === aKey)) || null;
  // Lyginam praeitį su vėlesne redakcija, tad `b` privalo būti naujesnis už `a`.
  const b = (a && bKey && galimos.find(r => r.editionToken === bKey && r.nuo > a.nuo)) || null;

  const tuscia = {
    act,
    pavadinimas: act.title ?? legalActId,
    redakcijos,
    a,
    b,
    suvestine: null,
    pakeitimai: [] as Pakeitimas[],
  };

  if (galimos.length < 2) {
    return {
      ...tuscia,
      klaida: 'Šis aktas turi mažiau nei dvi redakcijas su prieinamu tekstu, todėl palyginti nėra ko.',
    };
  }
  if (!a || !b) return { ...tuscia, klaida: null };

  const priesaga = await lenteliuPriesagas(legalActId);
  const [ikeltaA, ikeltaB] = await Promise.all([
    ikeltiRedakcija(legalActId, a.editionToken, priesaga),
    ikeltiRedakcija(legalActId, b.editionToken, priesaga),
  ]);

  // Sąraše redakcija pažymėta kaip turinti tekstą, bet sidecar'e jo nėra —
  // reta, bet tada geriau pasakyti, nei rodyti visą aktą kaip ištrintą.
  const beTeksto = !ikeltaA.ok ? { r: a, p: ikeltaA.priezastis }
    : !ikeltaB.ok ? { r: b, p: ikeltaB.priezastis } : null;
  if (beTeksto) {
    return {
      ...tuscia,
      klaida: `Redakcijos ${laikotarpis(beTeksto.r)} tekstas neprieinamas`
        + (beTeksto.p ? `: ${beTeksto.p}` : '.'),
    };
  }

  const visi = palygintiStruktura(ikeltaA.index, ikeltaB.index);
  const pakeitimai: Pakeitimas[] = visi.map((p: any) => ({
    partId: p.partId,
    pavadinimas: p.pavadinimas,
    pakopos: trumpintiPakopas(p.pakopos),
    pokytis: p.pokytis,
    eilutes: (p.pokytis === 'pakeista'
      ? daliesEilutes(p.pries, p.po)
      : [{ tipas: p.pokytis, tekstas: p.pokytis === 'pridėta' ? p.po : p.pries }]
    ) as SkirtumoEilute[],
  }));

  return {
    ...tuscia,
    pavadinimas: ikeltaB.pavadinimas ?? ikeltaA.pavadinimas ?? act.title ?? legalActId,
    klaida: null,
    suvestine: suskaiciuoti(visi),
    pakeitimai,
  };
}
