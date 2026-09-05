import type { Lentele, Rysys } from './tipai.ts';

/**
 * ER diagramos isdestymas (Sugiyama sluoksniais).
 *
 * Trys dalykai, be kuriu diagrama tampa neskaitoma:
 *
 *  1. Ciklai. Gyli skaiciuojant tiesiog „taikinys + 1“, ciklas kelia gyli be
 *     galo (vpmSutartys.sutartys <-> search ispute drobe iki 7000 px). Todel
 *     pirma DFS'u sudaromas DAG, o cikla uzdarancios briaunos i gyli neiskaitomos.
 *  2. Ilgos briaunos. Briauna, persokanti kelis sluoksnius, be tarpiniu mazgu
 *     brezama tiesiai per viska, kas pakeliui. Tokioms briaunoms iterpiami
 *     tarpiniai (dummy) mazgai - jie uzima savo vieta sluoksnyje, tad briauna
 *     eina laisvu koridoriumi, o ne per dezutes.
 *  3. Susikirtimai. Mazgu tvarka sluoksnyje renkama barycentro metodu
 *     (kelios eigos pirmyn ir atgal), pasiliekant geriausia varianta.
 *
 * Izoliuotos lenteles (be jokiu isoriniu raktu) i grafa neitraukiamos - jos
 * dedamos i tinkleli apacioje, kitaip virstu vienu ilgu stulpeliu.
 */

export const MIN_PLOTIS = 190;
export const MAX_PLOTIS = 300;
export const ANTRASTES_AUKSTIS = 26;
export const EILUTES_AUKSTIS = 16;
export const VIDINE_PARASTE = 8;
const TARPAS_X = 110;
const TARPAS_Y = 24;
const PARASTE = 20;

/**
 * Apytiksliai simbolio plociai. SVG teksto issimatuoti serveryje negalim, tad
 * remiames sriftu vidurkiais: antraste - 12px pusjuodis sans, eilutes - 11px
 * monospace (ten simbolio plotis fiksuotas, tad iverti tikslus).
 */
export const ANTRASTES_SIMBOLIS = 6.9;
export const EILUTES_SIMBOLIS = 6.62;

/** Antraste, kokia bus piesiama: `public` schema praleidziama. */
export function rodomaAntraste(l: Lentele): string {
  return l.schema === 'public' ? l.vardas : `${l.schema}.${l.vardas}`;
}

/** Dezutes plotis pagal turini: kad ilgi stulpeliu vardai neisliptu is remelio. */
export function reikalingasPlotis(antraste: string, eilutes: string[]): number {
  const antrastesPlotis = antraste.length * ANTRASTES_SIMBOLIS;
  const eiluciuPlotis = Math.max(0, ...eilutes.map((e) => e.length * EILUTES_SIMBOLIS));
  const reikia = Math.max(antrastesPlotis, eiluciuPlotis) + VIDINE_PARASTE * 2;
  return Math.min(MAX_PLOTIS, Math.max(MIN_PLOTIS, Math.ceil(reikia)));
}

export interface IsdestytasMazgas {
  lentele: Lentele;
  eilutes: string[];
  x: number;
  y: number;
  plotis: number;
  aukstis: number;
}

export interface IsdestytaBriauna {
  rysys: Rysys;
  /** Polilinijos taskai; pirmas - saltinio krastas, paskutinis - taikinio. */
  taskai: Array<{ x: number; y: number }>;
  /** true, kai briauna uzdaro cikla ir buvo apversta gyliui skaiciuoti. */
  atgaline: boolean;
}

export interface Isdestymas {
  mazgai: IsdestytasMazgas[];
  briaunos: IsdestytaBriauna[];
  izoliuoti: IsdestytasMazgas[];
  plotis: number;
  aukstis: number;
}

interface Slotas {
  raktas: string;
  aukstis: number;
  plotis: number;
  /** null tarpiniams (dummy) mazgams. */
  lentele: Lentele | null;
}

/** DFS, kuris pazymi cikla uzdarancias briaunas - jos i gyli neiskaitomos. */
function pasalintiCiklus(raktai: string[], briaunos: Rysys[]): Set<Rysys> {
  const adj = new Map<string, Rysys[]>();
  for (const r of raktai) adj.set(r, []);
  for (const e of briaunos) {
    if (e.is !== e.i && adj.has(e.is)) adj.get(e.is)!.push(e);
  }

  const busena = new Map<string, number>(); // 1 - kelyje, 2 - baigtas
  const atgalines = new Set<Rysys>();

  const eiti = (mazgas: string) => {
    busena.set(mazgas, 1);
    for (const e of adj.get(mazgas) ?? []) {
      const b = busena.get(e.i);
      if (b === 1) atgalines.add(e);
      else if (b === undefined) eiti(e.i);
    }
    busena.set(mazgas, 2);
  };

  for (const r of raktai) if (!busena.has(r)) eiti(r);
  return atgalines;
}

/** Ilgiausio kelio sluoksniavimas DAG'e: zodynai kaireje, priklausomi desineje. */
function sluoksniuoti(raktai: string[], briaunos: Rysys[]): Map<string, number> {
  const isTo = new Map<string, string[]>();
  for (const r of raktai) isTo.set(r, []);
  for (const e of briaunos) if (isTo.has(e.is)) isTo.get(e.is)!.push(e.i);

  const gyliai = new Map<string, number>();
  const skaiciuoti = (mazgas: string, kelyje: Set<string>): number => {
    const turimas = gyliai.get(mazgas);
    if (turimas !== undefined) return turimas;
    if (kelyje.has(mazgas)) return 0;

    kelyje.add(mazgas);
    let gylis = 0;
    for (const tikslas of isTo.get(mazgas) ?? []) {
      if (!isTo.has(tikslas)) continue;
      gylis = Math.max(gylis, skaiciuoti(tikslas, kelyje) + 1);
    }
    kelyje.delete(mazgas);

    gyliai.set(mazgas, gylis);
    return gylis;
  };

  for (const r of raktai) skaiciuoti(r, new Set());

  // Sutraukimas. Ilgiausio kelio sluoksniavimas nustumia visus zodynus i patI
  // kaire krasta, nors dauguma ju naudojami vos vieno mazgo - briaunos tada
  // driekiasi per visa drobe. Kiekviena mazga pastumiam kiek imanoma i desine:
  // i sluoksni pries arciausia ji naudojanti mazga.
  const naudotojai = new Map<string, string[]>();
  for (const e of briaunos) {
    if (!isTo.has(e.is) || !isTo.has(e.i)) continue;
    naudotojai.set(e.i, [...(naudotojai.get(e.i) ?? []), e.is]);
  }

  const eile = [...raktai].sort((a, b) => (gyliai.get(b) ?? 0) - (gyliai.get(a) ?? 0));
  for (const mazgas of eile) {
    const kas = naudotojai.get(mazgas);
    if (!kas?.length) continue;
    const arciausias = Math.min(...kas.map((k) => gyliai.get(k) ?? 0));
    if (arciausias - 1 > (gyliai.get(mazgas) ?? 0)) gyliai.set(mazgas, arciausias - 1);
  }

  return gyliai;
}

function susikirtimai(sluoksniai: Slotas[][], iDesine: Map<string, Set<string>>): number {
  let viso = 0;
  for (let i = 0; i + 1 < sluoksniai.length; i += 1) {
    const indeksas = new Map(sluoksniai[i + 1].map((s, j) => [s.raktas, j]));
    const poros: number[] = [];

    for (const slotas of sluoksniai[i]) {
      for (const t of iDesine.get(slotas.raktas) ?? []) {
        const j = indeksas.get(t);
        if (j !== undefined) poros.push(j);
      }
    }
    for (let a = 0; a < poros.length; a += 1) {
      for (let b = a + 1; b < poros.length; b += 1) if (poros[a] > poros[b]) viso += 1;
    }
  }
  return viso;
}

/** Barycentro eiga: mazgas traukiamas prie savo kaimynu vidurkio. */
function rikiuotiBarycentru(
  sluoksniai: Slotas[][],
  pirmyn: boolean,
  kaimynai: Map<string, Set<string>>,
): void {
  const eiga = pirmyn
    ? [...sluoksniai.keys()].slice(1)
    : [...sluoksniai.keys()].slice(0, -1).reverse();

  for (const i of eiga) {
    const gretimas = sluoksniai[pirmyn ? i - 1 : i + 1];
    const vietos = new Map(gretimas.map((s, j) => [s.raktas, j]));

    const svoriai = new Map<string, number>();
    sluoksniai[i].forEach((s, j) => {
      const reiksmes = [...(kaimynai.get(s.raktas) ?? [])]
        .map((k) => vietos.get(k))
        .filter((v): v is number => v !== undefined);
      svoriai.set(s.raktas, reiksmes.length
        ? reiksmes.reduce((a, b) => a + b, 0) / reiksmes.length
        : j);
    });

    sluoksniai[i].sort((a, b) => (svoriai.get(a.raktas)! - svoriai.get(b.raktas)!)
      || a.raktas.localeCompare(b.raktas, 'lt'));
  }
}

export function sudelioti(
  lenteles: Lentele[],
  rysiai: Rysys[],
  mazgoEilutes: (l: Lentele) => string[],
): Isdestymas {
  const savos = new Set(lenteles.map((l) => l.raktas));
  const briaunos = rysiai.filter((r) => savos.has(r.is) && savos.has(r.i) && r.is !== r.i);

  const susieti = new Set<string>();
  for (const e of briaunos) { susieti.add(e.is); susieti.add(e.i); }

  const grafas = lenteles.filter((l) => susieti.has(l.raktas));
  const izoliuotos = lenteles.filter((l) => !susieti.has(l.raktas));

  const aukstis = (l: Lentele) => {
    const n = mazgoEilutes(l).length;
    return ANTRASTES_AUKSTIS + n * EILUTES_AUKSTIS + (n ? 8 : 0);
  };

  // 1. DAG + sluoksniai.
  const raktai = grafas.map((l) => l.raktas);
  const atgalines = pasalintiCiklus(raktai, briaunos);
  const gyliai = sluoksniuoti(raktai, briaunos.filter((e) => !atgalines.has(e)));
  const maxGylis = Math.max(0, ...gyliai.values());

  // 2. Tarpiniai mazgai ilgoms briaunoms.
  const sluoksniai: Slotas[][] = Array.from({ length: maxGylis + 1 }, () => []);
  for (const l of grafas) {
    sluoksniai[gyliai.get(l.raktas) ?? 0].push({
      raktas: l.raktas,
      lentele: l,
      aukstis: aukstis(l),
      plotis: reikalingasPlotis(rodomaAntraste(l), mazgoEilutes(l)),
    });
  }

  const briaunosKeliai = new Map<Rysys, string[]>();
  let dummySkaitiklis = 0;
  for (const e of briaunos) {
    const atgal = atgalines.has(e);
    const nuo = atgal ? e.i : e.is;
    const iki = atgal ? e.is : e.i;
    const g1 = gyliai.get(nuo) ?? 0;
    const g2 = gyliai.get(iki) ?? 0;
    const kelias = [nuo];

    const zingsnis = g1 > g2 ? -1 : 1;
    if (g1 !== g2) {
      for (let g = g1 + zingsnis; g !== g2; g += zingsnis) {
        const raktas = ` dummy${dummySkaitiklis += 1}`;
        // Tarpinis mazgas rezervuoja VISA sluoksnio juostos ploti, ne taska.
        // Kitaip briauna, keliaudama pro sluoksni, kirstu jo dezutes.
        sluoksniai[g].push({ raktas, lentele: null, aukstis: 10, plotis: 0 });
        kelias.push(raktas);
      }
    }
    kelias.push(iki);
    briaunosKeliai.set(e, kelias);
  }

  // 3. Kaimynyste (per kelius, iskaitant tarpinius mazgus) ir rikiavimas.
  const iDesine = new Map<string, Set<string>>();
  const visiKaimynai = new Map<string, Set<string>>();
  const pridetiKaimyna = (a: string, b: string) => {
    if (!visiKaimynai.has(a)) visiKaimynai.set(a, new Set());
    visiKaimynai.get(a)!.add(b);
  };

  for (const kelias of briaunosKeliai.values()) {
    for (let i = 0; i + 1 < kelias.length; i += 1) {
      const [a, b] = [kelias[i], kelias[i + 1]];
      const gA = gyliai.get(a);
      const gB = gyliai.get(b);
      // Kelias eina nuo gilesnio i seklesni, tad „i desine“ yra b -> a.
      const kaireje = gA !== undefined && gB !== undefined && gA > gB ? b : a;
      const desineje = kaireje === a ? b : a;
      if (!iDesine.has(kaireje)) iDesine.set(kaireje, new Set());
      iDesine.get(kaireje)!.add(desineje);
      pridetiKaimyna(a, b);
      pridetiKaimyna(b, a);
    }
  }

  for (const s of sluoksniai) s.sort((a, b) => a.raktas.localeCompare(b.raktas, 'lt'));

  let geriausia = sluoksniai.map((s) => [...s]);
  let geriausiaKaina = susikirtimai(sluoksniai, iDesine);
  for (let ratas = 0; ratas < 6; ratas += 1) {
    rikiuotiBarycentru(sluoksniai, ratas % 2 === 0, visiKaimynai);
    const kaina = susikirtimai(sluoksniai, iDesine);
    if (kaina < geriausiaKaina) {
      geriausiaKaina = kaina;
      geriausia = sluoksniai.map((s) => [...s]);
    }
  }

  // 4. Koordinates.
  const slotoVieta = new Map<string, { x: number; y: number; aukstis: number; plotis: number }>();
  const mazgai: IsdestytasMazgas[] = [];
  let drobesAukstis = 0;

  // Sluoksnio plotis - placiausio jo mazgo; tarpiniai mazgai uzima ta pati
  // ploti, kad briauna eitu skersai visos juostos, o ne per dezutes.
  const sluoksniuPlociai = geriausia.map((sluoksnis) =>
    Math.max(MIN_PLOTIS, ...sluoksnis.map((s) => s.plotis)));

  const sluoksniuX: number[] = [];
  let x = PARASTE;
  for (const plotis of sluoksniuPlociai) {
    sluoksniuX.push(x);
    x += plotis + TARPAS_X;
  }

  geriausia.forEach((sluoksnis, gylis) => {
    const sluoksnioX = sluoksniuX[gylis];
    const juostosPlotis = sluoksniuPlociai[gylis];
    let y = PARASTE;
    for (const slotas of sluoksnis) {
      const plotis = slotas.lentele ? slotas.plotis : juostosPlotis;
      slotoVieta.set(slotas.raktas, { x: sluoksnioX, y, aukstis: slotas.aukstis, plotis });
      if (slotas.lentele) {
        mazgai.push({
          lentele: slotas.lentele,
          eilutes: mazgoEilutes(slotas.lentele),
          x: sluoksnioX, y, plotis, aukstis: slotas.aukstis,
        });
      }
      y += slotas.aukstis + TARPAS_Y;
    }
    drobesAukstis = Math.max(drobesAukstis, y);
  });

  // 5. Briaunu marsrutai per tarpiniu mazgu vietas.
  const isdestytosBriaunos: IsdestytaBriauna[] = [];
  for (const [rysys, kelias] of briaunosKeliai) {
    const vietos = kelias
      .map((k) => slotoVieta.get(k))
      .filter((v): v is { x: number; y: number; aukstis: number; plotis: number } => Boolean(v));
    if (vietos.length < 2) continue;

    const paskutinis = vietos.length - 1;
    const einaKairen = vietos[0].x > vietos[paskutinis].x;

    const taskai: Array<{ x: number; y: number }> = [];
    vietos.forEach((v, i) => {
      const vidurys = v.y + v.aukstis / 2;
      if (i === 0) {
        taskai.push({ x: einaKairen ? v.x : v.x + v.plotis, y: vidurys });
      } else if (i === paskutinis) {
        taskai.push({ x: einaKairen ? v.x + v.plotis : v.x, y: vidurys });
      } else {
        // Tarpinis mazgas duoda du taskus - ijima i rezervuota juosta ir isejima
        // is jos, kad horizontalus perejimas per sluoksni eitu laisva eilute.
        taskai.push({ x: einaKairen ? v.x + v.plotis : v.x, y: vidurys });
        taskai.push({ x: einaKairen ? v.x : v.x + v.plotis, y: vidurys });
      }
    });

    isdestytosBriaunos.push({ rysys, taskai, atgaline: atgalines.has(rysys) });
  }

  // 6. Izoliuotos lenteles - tinkleliu po grafu.
  const izoliuoti: IsdestytasMazgas[] = [];
  if (izoliuotos.length) {
    const stulpeliai = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(izoliuotos.length * 1.6))));
    let eilutesY = mazgai.length ? drobesAukstis + TARPAS_Y : PARASTE;
    let didziausiasEileje = 0;

    const surikiuotos = [...izoliuotos].sort((a, b) => a.vardas.localeCompare(b.vardas, 'lt'));
    // Vienodas tinklelio zingsnis - kad stulpeliai liktu sulygiuoti.
    const zingsnis = Math.max(
      MIN_PLOTIS,
      ...surikiuotos.map((l) => reikalingasPlotis(rodomaAntraste(l), mazgoEilutes(l))),
    ) + TARPAS_Y;

    surikiuotos.forEach((l, i) => {
      const stulpelis = i % stulpeliai;
      if (stulpelis === 0 && i > 0) {
        eilutesY += didziausiasEileje + TARPAS_Y;
        didziausiasEileje = 0;
      }
      const h = aukstis(l);
      didziausiasEileje = Math.max(didziausiasEileje, h);
      izoliuoti.push({
        lentele: l,
        eilutes: mazgoEilutes(l),
        x: PARASTE + stulpelis * zingsnis,
        y: eilutesY,
        plotis: zingsnis - TARPAS_Y,
        aukstis: h,
      });
    });
  }

  const visi = [...mazgai, ...izoliuoti];
  return {
    mazgai,
    briaunos: isdestytosBriaunos,
    izoliuoti,
    plotis: (visi.length ? Math.max(...visi.map((m) => m.x + m.plotis)) : 0) + PARASTE,
    aukstis: (visi.length ? Math.max(...visi.map((m) => m.y + m.aukstis)) : 0) + PARASTE,
  };
}
