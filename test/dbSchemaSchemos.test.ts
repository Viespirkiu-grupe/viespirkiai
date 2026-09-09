import { describe, expect, it } from 'vitest';
import { lentelesUrl, lentelesUrlIsRakto, schemosUrl } from '@/src/lib/dbSchema/schemos.ts';
import { rasti } from '@/src/lib/dbSchema/modelis.ts';
import type { Lentele, SchemosModelis } from '@/src/lib/dbSchema/tipai.ts';

function lentele(schema: string, vardas: string): Lentele {
  return {
    raktas: `${schema}.${vardas}`,
    schema,
    vardas,
    aprasymas: null,
    stulpeliai: [],
    ribojimai: [],
    indeksai: [],
    trigeriai: [],
    duomenuDydis: 0,
    indeksuDydis: 0,
    bendrasDydis: 0,
    eiluciuIvertis: 0,
    meta: null,
  };
}

function modelis(...lenteles: Lentele[]): SchemosModelis {
  return {
    lenteles,
    pagalRakta: new Map(lenteles.map((l) => [l.raktas, l])),
    schemos: [],
    schemosPagalVarda: new Map(),
    rysiai: [],
    metrikos: {
      lenteliu: lenteles.length,
      stulpeliu: 0,
      isoriniuRaktu: 0,
      bendrasDydis: 0,
      eiluciuIvertis: 0,
      aprasytaLenteliu: 0,
      aprasytaStulpeliu: 0,
      schemu: 0,
    },
    sudaryta: new Date().toISOString(),
    metaKlaida: null,
  };
}

describe('adresai', () => {
  it('schema visada yra atskiras kelio segmentas', () => {
    expect(schemosUrl('cvpp')).toBe('/duomenys/lenteles/cvpp');
    expect(lentelesUrl('cvpp', 'skelbimai')).toBe('/duomenys/lenteles/cvpp/skelbimai');
  });

  // Anksčiau `public` iš adreso buvo išimama; dabar schema nebeslepiama, nes ji
  // yra ne prierašas prie vardo, o pats grupavimas.
  it('`public` nebeslepiama', () => {
    expect(lentelesUrl('public', 'spatial_ref_sys'))
      .toBe('/duomenys/lenteles/public/spatial_ref_sys');
  });

  it('nesaugius simbolius užkoduoja', () => {
    expect(lentelesUrl('dba', 'a b/c')).toBe('/duomenys/lenteles/dba/a%20b%2Fc');
  });

  it('iš rakto atkuria adresą skeldamas ties pirmuoju tašku', () => {
    expect(lentelesUrlIsRakto('eTar.eTarLegalAct')).toBe('/duomenys/lenteles/eTar/eTarLegalAct');
    expect(lentelesUrlIsRakto('dba.a.b')).toBe('/duomenys/lenteles/dba/a.b');
    expect(lentelesUrlIsRakto('beTasko')).toBe('/duomenys/lenteles');
  });
});

describe('rasti', () => {
  const m = modelis(
    lentele('sabis', 'sutartys'),
    lentele('vpmSutartys', 'sutartys'),
    lentele('bvpz', 'kodai'),
  );

  it('randa pagal pilną raktą', () => {
    expect(rasti(m, 'sabis.sutartys')?.schema).toBe('sabis');
  });

  it('randa pagal vien vardą, kai jis visoje bazėje vienintelis', () => {
    expect(rasti(m, 'kodai')?.raktas).toBe('bvpz.kodai');
  });

  // Spėti už lankytoją būtų blogiau nei nuvesti į sąrašą: `sutartys` yra
  // dviejose schemose ir jos nesusijusios.
  it('dviprasmiško vardo nespėlioja', () => {
    expect(rasti(m, 'sutartys')).toBeNull();
  });

  it('nežinomo vardo neranda', () => {
    expect(rasti(m, 'neraTokios')).toBeNull();
  });
});
