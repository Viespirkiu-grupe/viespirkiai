import { describe, expect, it } from 'vitest';
import { gautiSchemosModeli, kaimynyste, rasti } from '@/src/lib/dbSchema/modelis.ts';

/** Integracinis patikrinimas prieš gyvą DB katalogą. */
describe('gautiSchemosModeli', () => {
  it('sulipdo visos bazės modelį', async () => {
    const t0 = Date.now();
    const m = await gautiSchemosModeli();
    console.log('krova ms:', Date.now() - t0, '| metaKlaida:', m.metaKlaida);
    console.log('metrikos:', JSON.stringify(m.metrikos));
    console.log('schemos:', m.schemos.map((s) => s.vardas).join(', '));

    expect(m.lenteles.length).toBeGreaterThan(400);
    expect(m.metrikos.isoriniuRaktu).toBeGreaterThan(200);
    expect(m.metrikos.schemu).toBe(m.schemos.length);

    // Grupavimo nebėra: kiekviena lentelė turi savo schemos aprašą, ir „nesugrupuotų“
    // būti negali iš principo.
    const beAprasymo = m.lenteles.filter((l) => !m.schemosPagalVarda.has(l.schema));
    expect(beAprasymo).toEqual([]);

    const eppsSkelbimai = rasti(m, 'eppsViesiejiPirkimai.skelbimai')!;
    console.log('eppsViesiejiPirkimai.skelbimai:', eppsSkelbimai.stulpeliai.length, 'stulpeliu,',
      eppsSkelbimai.indeksai.length, 'indeksu, schema', eppsSkelbimai.schema);
    expect(eppsSkelbimai.stulpeliai.length).toBeGreaterThan(5);

    const cv = rasti(m, 'cvppDump.atn1')!;
    console.log('cvppDump.atn1 aprasymas:', cv.aprasymas?.slice(0, 50));
    console.log('cvppDump.atn1 aprasytu stulpeliu:', cv.stulpeliai.filter((s) => s.aprasymas).length);
    expect(cv.aprasymas).toBeTruthy();

    const k = kaimynyste(m, eppsSkelbimai.raktas, 1);
    console.log('kaimynyste:', k.lenteles.length, 'lenteliu,', k.rysiai.length, 'rysiu');

    const t1 = Date.now();
    await gautiSchemosModeli();
    console.log('antra krova (kesas) ms:', Date.now() - t1);
    expect(Date.now() - t1).toBeLessThan(50);
  });
});
