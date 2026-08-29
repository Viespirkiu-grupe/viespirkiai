import { describe, expect, it } from 'vitest';
import { piestiSvg } from '@/src/lib/dbSchema/erDiagrama.ts';
import { ANTRASTES_SIMBOLIS, EILUTES_SIMBOLIS, VIDINE_PARASTE } from '@/src/lib/dbSchema/erIsdestymas.ts';
import type { Lentele, Rysys } from '@/src/lib/dbSchema/tipai.ts';

function lentele(vardas: string, stulpeliai: Array<[string, 'pk' | 'fk' | null]> = []): Lentele {
  return {
    raktas: `public.${vardas}`,
    schema: 'public',
    vardas,
    aprasymas: null,
    stulpeliai: stulpeliai.map(([v, zyme]) => ({
      vardas: v,
      tipas: 'text',
      arButinas: false,
      numatytoji: null,
      generuota: false,
      aprasymas: null,
      arPirminis: zyme === 'pk',
      isorinisRaktas: zyme === 'fk' ? 'public.kita' : null,
    })),
    ribojimai: [],
    indeksai: [],
    trigeriai: [],
    duomenuDydis: 0,
    indeksuDydis: 0,
    bendrasDydis: 0,
    eiluciuIvertis: 0,
    grupe: { raktas: 'g', pavadinimas: 'G', aprasymas: null, saltinis: null, saltinioUrl: null, tvarka: 1 },
    grupePriskirtaRankomis: false,
    meta: null,
  };
}

function rysys(is: string, i: string): Rysys {
  return { is: `public.${is}`, i: `public.${i}`, vardas: `${is}_fkey`, stulpeliai: ['id'], isoriniaiStulpeliai: ['id'] };
}

describe('piestiSvg', () => {
  const lenteles = [
    lentele('sutartys', [['id', 'pk'], ['tipasId', 'fk']]),
    lentele('tipai', [['id', 'pk']]),
    lentele('salys', [['id', 'pk'], ['sutartisId', 'fk']]),
  ];
  const rysiai = [rysys('sutartys', 'tipai'), rysys('salys', 'sutartys')];

  it('tas pats įėjimas duoda identišką SVG', () => {
    const a = piestiSvg(lenteles, rysiai);
    const b = piestiSvg(lenteles, rysiai);
    expect(a.svg).toBe(b.svg);
    expect(a.mazgu).toBe(3);
    expect(a.briaunu).toBe(2);
  });

  it('mazgų tvarka nepriklauso nuo įėjimo masyvo tvarkos', () => {
    const a = piestiSvg(lenteles, rysiai);
    const b = piestiSvg([...lenteles].reverse(), [...rysiai].reverse());
    expect(a.svg).toBe(b.svg);
  });

  it('žodynas be išorinių raktų atsiduria kairiausiai', () => {
    const { svg } = piestiSvg(lenteles, rysiai);
    const tipaiX = Number(/<rect class="er-box" x="(\d+)"[^>]*\/><rect class="er-head"[^>]*\/><text class="er-title"[^>]*>tipai</.exec(svg)?.[1]);
    const salysX = Number(/<rect class="er-box" x="(\d+)"[^>]*\/><rect class="er-head"[^>]*\/><text class="er-title"[^>]*>salys</.exec(svg)?.[1]);
    expect(tipaiX).toBeLessThan(salysX);
  });

  it('ciklinis FK neužkabina išdėstymo', () => {
    const ciklas = [lentele('a', [['id', 'pk']]), lentele('b', [['id', 'pk']])];
    const ciklorysiai = [rysys('a', 'b'), rysys('b', 'a')];
    const rezultatas = piestiSvg(ciklas, ciklorysiai);
    expect(rezultatas.mazgu).toBe(2);
    expect(rezultatas.svg).toContain('<svg');
  });

  it('kompaktinis režimas nerodo stulpelių', () => {
    const pilnas = piestiSvg(lenteles, rysiai);
    const kompaktinis = piestiSvg(lenteles, rysiai, { kompaktinis: true });
    expect(pilnas.svg).toContain('PK id');
    expect(kompaktinis.svg).not.toContain('PK id');
  });

  it('tuščias sąrašas negriūva', () => {
    expect(piestiSvg([], [])).toEqual({ svg: '', mazgu: 0, briaunu: 0, izoliuotu: 0 });
  });

  it('ciklas neišpučia drobės pločio', () => {
    // vpmSutartys <-> vpmSutartysSearch tipo ciklas anksčiau kėlė gylį kas
    // iteraciją ir drobė išsitempdavo iki tūkstančių pikselių.
    const a = lentele('a', [['id', 'pk']]);
    const b = lentele('b', [['id', 'pk']]);
    const { svg } = piestiSvg([a, b], [rysys('a', 'b'), rysys('b', 'a')]);
    const plotis = Number(/viewBox="0 0 ([\d.]+)/.exec(svg)![1]);
    expect(plotis).toBeLessThan(600);
  });

  it('lentelės be ryšių dedamos į tinklelį, o ne į vieną stulpelį', () => {
    const be = Array.from({ length: 9 }, (_, i) => lentele(`t${i}`, [['id', 'pk']]));
    const rez = piestiSvg(be, []);
    expect(rez.izoliuotu).toBe(9);

    const xs = new Set([...rez.svg.matchAll(/<rect class="er-box" x="([\d.]+)"/g)].map(m => m[1]));
    expect(xs.size).toBeGreaterThan(1);
  });

  it('nė viena briauna nekerta lentelės dėžutės', () => {
    // Grandinė a -> b -> c -> d plius trumpikė a -> d: pastaroji peršoka du
    // sluoksnius, tad be tarpinių mazgų eitų tiesiai per b ir c dėžutes.
    const l = ['a', 'b', 'c', 'd'].map(v => lentele(v, [['id', 'pk']]));
    const r = [rysys('a', 'b'), rysys('b', 'c'), rysys('c', 'd'), rysys('a', 'd')];
    const { svg } = piestiSvg(l, r);

    const dezes = [...svg.matchAll(/<rect class="er-box" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
      .map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
    const keliai = [...svg.matchAll(/<path class="er-edge[^"]*" d="([^"]+)"/g)].map(m => m[1]);
    expect(keliai.length).toBe(4);

    for (const d of keliai) {
      const n = d.match(/-?[\d.]+/g)!.map(Number);
      const taskai = [{ x: n[0], y: n[1] }];
      for (let i = 2; i + 5 < n.length + 1; i += 6) {
        const p0 = taskai[taskai.length - 1];
        const [c1x, c1y, c2x, c2y, ex, ey] = n.slice(i, i + 6);
        for (let t = 0.05; t <= 1.0001; t += 0.05) {
          const u = 1 - t;
          taskai.push({
            x: u ** 3 * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t ** 3 * ex,
            y: u ** 3 * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t ** 3 * ey,
          });
        }
      }
      const galuose = (b: typeof dezes[0], p: { x: number; y: number }) =>
        p.x >= b.x - 2 && p.x <= b.x + b.w + 2 && p.y >= b.y - 2 && p.y <= b.y + b.h + 2;

      for (const b of dezes) {
        if (galuose(b, taskai[0]) || galuose(b, taskai[taskai.length - 1])) continue;
        const kerta = taskai.some(p =>
          p.x > b.x + 3 && p.x < b.x + b.w - 3 && p.y > b.y + 3 && p.y < b.y + b.h - 3);
        expect(kerta).toBe(false);
      }
    }
  });

  it('ilgi vardai netelpantys į dėžutę trumpinami viduriu', () => {
    const ilgas = lentele('rcInformaciniaiLeidiniaiPranesimaiPavadinimai', [
      ['perkanciosiosOrganizacijosPavadinimoId', 'fk'],
    ]);
    const { svg } = piestiSvg([ilgas], []);

    const dezes = [...svg.matchAll(/<rect class="er-box" x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
      .map(m => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
    expect(dezes).toHaveLength(1);
    const d = dezes[0];

    for (const t of svg.matchAll(/<text class="er-(title|col)" x="([\d.]+)" y="([\d.]+)"[^>]*>(?:<title>[^<]*<\/title>)?([^<]*)</g)) {
      const [, klase, , , tekstas] = t;
      const plotis = tekstas.length * (klase === 'title' ? ANTRASTES_SIMBOLIS : EILUTES_SIMBOLIS);
      expect(plotis).toBeLessThanOrEqual(d.w - VIDINE_PARASTE * 2 + 0.5);
    }

    // Trumpinama viduriu, kad liktų ir pradžia, ir skiriamoji pabaiga.
    expect(svg).toContain('…');
    expect(svg).toMatch(/PK|FK/);
    // Pilnas vardas pasiekiamas užvedus pelę.
    expect(svg).toContain('perkanciosiosOrganizacijosPavadinimoId');
  });

  it('lentelės vardas ekranuojamas', () => {
    const pavojinga = lentele('a<b>&c');
    expect(piestiSvg([pavojinga], []).svg).toContain('a&lt;b&gt;&amp;c');
  });
});
