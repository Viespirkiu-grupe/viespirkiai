import { describe, expect, it } from 'vitest';
import {
  NESUGRUPUOTA,
  grupeIsTaisykliu,
  lentelesUrl,
  priskirtiGrupe,
  type Taisykle,
} from '@/src/lib/dbSchema/grupes.ts';
import type { Grupe } from '@/src/lib/dbSchema/tipai.ts';

function taisykle(prefiksas: string, grupesRaktas: string, grieztaRiba = true): Taisykle {
  return { prefiksas, grupesRaktas, grieztaRiba, prioritetas: 0 };
}

function grupe(raktas: string): Grupe {
  return { raktas, pavadinimas: raktas, aprasymas: null, saltinis: null, saltinioUrl: null, tvarka: 1 };
}

const TAISYKLES = [
  taisykle('jar', 'juridiniai'),
  taisykle('jarCsv', 'jarCsv'),
  taisykle('eTar', 'etar'),
  taisykle('xlsxPPA', 'ppa', false),
  taisykle('statistika', 'infrastruktura'),
];

describe('grupeIsTaisykliu', () => {
  it('taiko prefiksą ties camelCase riba', () => {
    expect(grupeIsTaisykliu('jarZymuStatusai', TAISYKLES)).toBe('juridiniai');
    expect(grupeIsTaisykliu('eTarLegalAct', TAISYKLES)).toBe('etar');
  });

  it('nesugriebia nesusijusio vardo, prasidedančio tuo pačiu prefiksu', () => {
    // Būtent dėl to ir reikia camelCase ribos: `jar` yra labai trumpas prefiksas,
    // o po jo einanti mažoji raidė reiškia visai kitą žodį, ne šeimos narį.
    expect(grupeIsTaisykliu('jargonas', TAISYKLES)).toBeNull();
    expect(grupeIsTaisykliu('apiRaktai', TAISYKLES)).toBeNull();
  });

  it('leidžia tikslų vardo sutapimą', () => {
    expect(grupeIsTaisykliu('jar', TAISYKLES)).toBe('juridiniai');
    expect(grupeIsTaisykliu('statistika', TAISYKLES)).toBe('infrastruktura');
  });

  it('ilgesnis prefiksas nugali trumpesnį', () => {
    expect(grupeIsTaisykliu('jarCsvAtnaujinimai', TAISYKLES)).toBe('jarCsv');
    expect(grupeIsTaisykliu('jarAsmenys', TAISYKLES)).toBe('juridiniai');
  });

  it('be griežtos ribos priima ir mažąją raidę', () => {
    expect(grupeIsTaisykliu('xlsxPPAataskaitos', TAISYKLES)).toBe('ppa');
    expect(grupeIsTaisykliu('xlsxPPAdalyviai', TAISYKLES)).toBe('ppa');
  });

  it('grąžina null, kai nė viena taisyklė netinka', () => {
    expect(grupeIsTaisykliu('bvpzKodai', TAISYKLES)).toBeNull();
  });
});

describe('priskirtiGrupe', () => {
  const grupes = new Map([['juridiniai', grupe('juridiniai')], ['etar', grupe('etar')]]);

  it('rankinis priskyrimas nugali taisyklę', () => {
    const { grupe: rasta, rankomis } = priskirtiGrupe('jarZymuStatusai', 'etar', TAISYKLES, grupes);
    expect(rasta.raktas).toBe('etar');
    expect(rankomis).toBe(true);
  });

  it('be rankinio įrašo taiko taisyklę', () => {
    const { grupe: rasta, rankomis } = priskirtiGrupe('jarZymuStatusai', null, TAISYKLES, grupes);
    expect(rasta.raktas).toBe('juridiniai');
    expect(rankomis).toBe(false);
  });

  it('nežinomos lentelės patenka į „Nesugrupuota“', () => {
    const { grupe: rasta } = priskirtiGrupe('bvpzKodai', null, TAISYKLES, grupes);
    expect(rasta.raktas).toBe(NESUGRUPUOTA.raktas);
  });

  it('nurodytas, bet neegzistuojantis grupės raktas krenta į taisyklę', () => {
    const { grupe: rasta, rankomis } = priskirtiGrupe('jarZymuStatusai', 'nera', TAISYKLES, grupes);
    expect(rasta.raktas).toBe('juridiniai');
    expect(rankomis).toBe(false);
  });
});

describe('lentelesUrl', () => {
  it('praleidžia public schemą', () => {
    expect(lentelesUrl('etar', 'public', 'eTarLegalAct')).toBe('/duomenys/lenteles/etar/eTarLegalAct');
  });

  it('kitas schemas rodo su prefiksu', () => {
    expect(lentelesUrl('dokumentacija', 'dba', 'grupes')).toBe('/duomenys/lenteles/dokumentacija/dba.grupes');
  });
});
