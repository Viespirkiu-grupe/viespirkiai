import { describe, expect, it } from 'vitest';
import { gautiSchemosModeli, kaimynyste, rasti } from '@/src/lib/dbSchema/modelis.ts';

/** Integracinis patikrinimas prieš gyvą DB katalogą. */
describe('gautiSchemosModeli', () => {
  it('sulipdo visos bazės modelį', async () => {
    const t0 = Date.now();
    const m = await gautiSchemosModeli();
    console.log('krova ms:', Date.now() - t0, '| metaKlaida:', m.metaKlaida);
    console.log('metrikos:', JSON.stringify(m.metrikos));
    console.log('grupes:', m.grupes.map((g) => `${g.raktas}`).join(', '));

    expect(m.lenteles.length).toBeGreaterThan(300);
    expect(m.metrikos.isoriniuRaktu).toBeGreaterThan(200);

    const vp = rasti(m, 'viesiejiPirkimai')!;
    console.log('viesiejiPirkimai:', vp.stulpeliai.length, 'stulpeliu,', vp.indeksai.length, 'indeksu, grupe', vp.grupe.raktas);
    expect(vp.stulpeliai.length).toBeGreaterThan(5);

    const cv = rasti(m, 'cvppDump.atn1')!;
    console.log('cvppDump.atn1 aprasymas:', cv.aprasymas?.slice(0, 50));
    console.log('cvppDump.atn1 aprasytu stulpeliu:', cv.stulpeliai.filter((s) => s.aprasymas).length);
    expect(cv.aprasymas).toBeTruthy();

    const k = kaimynyste(m, 'public.viesiejiPirkimai', 1);
    console.log('kaimynyste:', k.lenteles.length, 'lenteliu,', k.rysiai.length, 'rysiu');

    const t1 = Date.now();
    await gautiSchemosModeli();
    console.log('antra krova (kesas) ms:', Date.now() - t1);
    expect(Date.now() - t1).toBeLessThan(50);
  });
});
