import type { Lentele, Rysys } from './tipai.ts';
import { lentelesUrl } from './grupes.ts';
import { rodomasVardas } from './formatavimas.ts';
import {
  ANTRASTES_AUKSTIS,
  ANTRASTES_SIMBOLIS,
  EILUTES_AUKSTIS,
  EILUTES_SIMBOLIS,
  VIDINE_PARASTE,
  rodomaAntraste,
  sudelioti,
  type IsdestytaBriauna,
  type IsdestytasMazgas,
} from './erIsdestymas.ts';

/**
 * ER diagrama kaip serveryje sugeneruotas SVG - be kliento bibliotek11u.
 *
 * Isdestymas (sluoksniai, tarpiniai mazgai, susikirtimu mazinimas) gyvena
 * erIsdestymas.ts; cia lieka tik piesimas. Rezultatas deterministinis, tad ta
 * pati grupe visada atrodo vienodai ir nuoroda yra pasidalinama.
 *
 * Kiekvienas mazgas yra <a> - diagrama veikia kaip navigacija.
 */

const MAX_STULPELIU = 6;

export interface DiagramosNustatymai {
  /** `kompaktinis` - tik dezutes be stulpeliu. */
  kompaktinis?: boolean;
}

function ekranuoti(tekstas: string): string {
  return tekstas
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Rodomi tik raktiniai stulpeliai - visas 146 stulpeliu sarasas diagramai netinka. */
function mazgoEilutes(lentele: Lentele, kompaktinis: boolean): string[] {
  if (kompaktinis) return [];

  const svarbus = lentele.stulpeliai.filter((s) => s.arPirminis || s.isorinisRaktas);
  const rodomi = svarbus.slice(0, MAX_STULPELIU)
    .map((s) => `${s.arPirminis ? 'PK' : 'FK'} ${s.vardas}`);

  if (svarbus.length > MAX_STULPELIU) rodomi.push(`+${svarbus.length - MAX_STULPELIU} dar`);
  return rodomi;
}

/**
 * Trumpinimas viduriu, kai tekstas netelpa i dezute.
 *
 * Viduriu, o ne gale, todel kad butent vidurys ir galas skiria panasius vardus:
 * `perkanciosiosOrganizacijosPavadinimoId` ir `perkanciosiosOrganizacijosTipasId`
 * nukirpti gale butu neatskiriami.
 */
function sutrumpinti(tekstas: string, plotisPx: number, simbolioPlotis: number): string {
  const telpa = Math.floor(plotisPx / simbolioPlotis);
  if (tekstas.length <= telpa || telpa < 6) return tekstas;

  const likutis = telpa - 1;
  const priekis = Math.ceil(likutis / 2);
  const galas = likutis - priekis;
  return `${tekstas.slice(0, priekis)}…${galas ? tekstas.slice(-galas) : ''}`;
}

function piestiMazga(mazgas: IsdestytasMazgas): string {
  const { lentele, x, y, plotis, aukstis } = mazgas;
  const url = lentelesUrl(lentele.grupe.raktas, lentele.schema, lentele.vardas);
  const pavadinimas = rodomasVardas(lentele.schema, lentele.vardas);
  const vidus = plotis - VIDINE_PARASTE * 2;
  const antraste = sutrumpinti(rodomaAntraste(lentele), vidus, ANTRASTES_SIMBOLIS);

  const eilutes = mazgas.eilutes.map((tekstas, i) => {
    const ey = y + ANTRASTES_AUKSTIS + 12 + i * EILUTES_AUKSTIS;
    const rodoma = sutrumpinti(tekstas, vidus, EILUTES_SIMBOLIS);
    // Nukirptas vardas gauna savo <title> - pilna reiksme matoma uzvedus pele.
    const uzuomina = rodoma === tekstas ? '' : `<title>${ekranuoti(tekstas)}</title>`;
    return `<text class="er-col" x="${x + VIDINE_PARASTE}" y="${ey}">${uzuomina}${ekranuoti(rodoma)}</text>`;
  }).join('');

  return `<a href="${ekranuoti(url)}" class="er-node">`
    + `<title>${ekranuoti(pavadinimas)}${lentele.aprasymas ? ` — ${ekranuoti(lentele.aprasymas)}` : ''}</title>`
    + `<rect class="er-box" x="${x}" y="${y}" width="${plotis}" height="${aukstis}" rx="4"/>`
    + `<rect class="er-head" x="${x}" y="${y}" width="${plotis}" height="${ANTRASTES_AUKSTIS}" rx="4"/>`
    + `<text class="er-title" x="${x + VIDINE_PARASTE}" y="${y + 18}">${ekranuoti(antraste)}</text>`
    + eilutes
    + '</a>';
}

const apvalinti = (n: number) => Math.round(n * 10) / 10;

/**
 * Svelni polilinija per marsruto taskus: horizontalus isejimas ir ijimas, o
 * tarp ju - kubines Bezier atkarpos. Kreives geriau skiriasi viena nuo kitos
 * nei staciakampiai lauziai, kai i ta pati mazga sueina kelios briaunos.
 */
function piestiKelia(taskai: Array<{ x: number; y: number }>): string {
  const t = taskai.map((p) => ({ x: apvalinti(p.x), y: apvalinti(p.y) }));
  let d = `M ${t[0].x} ${t[0].y}`;

  for (let i = 0; i + 1 < t.length; i += 1) {
    const a = t[i];
    const b = t[i + 1];
    const dx = (b.x - a.x) / 2;
    d += ` C ${apvalinti(a.x + dx)} ${a.y} ${apvalinti(b.x - dx)} ${b.y} ${b.x} ${b.y}`;
  }
  return d;
}

function piestiBriauna(briauna: IsdestytaBriauna): string {
  const { rysys, taskai, atgaline } = briauna;
  const zyme = `${rysys.stulpeliai.join(', ')} → ${rysys.i.replace(/^public\./, '')}`
    + (atgaline ? ' (ciklas)' : '');

  return `<path class="er-edge${atgaline ? ' er-edge--atgal' : ''}" d="${piestiKelia(taskai)}"`
    + ' marker-end="url(#er-rodykle)">'
    + `<title>${ekranuoti(zyme)}</title></path>`;
}

export interface DiagramosRezultatas {
  svg: string;
  mazgu: number;
  briaunu: number;
  /** Lenteliu be isoriniu raktu, rodomu tinkleliu apacioje. */
  izoliuotu: number;
}

export function piestiSvg(
  lenteles: Lentele[],
  rysiai: Rysys[],
  nustatymai: DiagramosNustatymai = {},
): DiagramosRezultatas {
  if (!lenteles.length) return { svg: '', mazgu: 0, briaunu: 0, izoliuotu: 0 };

  const kompaktinis = nustatymai.kompaktinis ?? false;
  const isdestymas = sudelioti(lenteles, rysiai, (l) => mazgoEilutes(l, kompaktinis));

  // Briaunos piesiamos pirmos, kad dezutes liktu virsuje; abi grupes rikiuojamos,
  // kad SVG nepriklausytu nuo ijimo masyvo tvarkos.
  const briaunos = [...isdestymas.briaunos]
    .sort((a, b) => a.rysys.is.localeCompare(b.rysys.is, 'lt')
      || a.rysys.i.localeCompare(b.rysys.i, 'lt')
      || a.rysys.vardas.localeCompare(b.rysys.vardas, 'lt'))
    .map(piestiBriauna)
    .join('');

  const dezes = [...isdestymas.mazgai, ...isdestymas.izoliuoti]
    .sort((a, b) => a.lentele.raktas.localeCompare(b.lentele.raktas, 'lt'))
    .map(piestiMazga)
    .join('');

  const svg = '<svg xmlns="http://www.w3.org/2000/svg" '
    + `viewBox="0 0 ${isdestymas.plotis} ${isdestymas.aukstis}" `
    + `width="${isdestymas.plotis}" height="${isdestymas.aukstis}" class="er-svg" role="img">`
    + '<defs><marker id="er-rodykle" viewBox="0 0 10 10" refX="9" refY="5" '
    + 'markerWidth="6" markerHeight="6" orient="auto-start-reverse">'
    + '<path d="M 0 0 L 10 5 L 0 10 z" class="er-arrow"/></marker></defs>'
    + briaunos
    + dezes
    + '</svg>';

  return {
    svg,
    mazgu: isdestymas.mazgai.length + isdestymas.izoliuoti.length,
    briaunu: isdestymas.briaunos.length,
    izoliuotu: isdestymas.izoliuoti.length,
  };
}

/** Virs sios ribos stulpeliai diagramoje nebetelpa - jungiam kompaktini rezima. */
export const KOMPAKTINIO_RIBA = 25;
