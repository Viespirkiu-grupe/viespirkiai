import { describe, expect, it } from 'vitest';
import { suma, data, slugas } from '../modules/2014esinvesticijos/tekstas.js';
import { parseSarasoPuslapi, parseFiltrus } from '../modules/2014esinvesticijos/parseSarasa.js';
import { parseProjektoPuslapi } from '../modules/2014esinvesticijos/parseProjekta.js';
import { parsePriemoniuSarasa } from '../modules/2014esinvesticijos/parsePriemone.js';

describe('2014esinvesticijos teksto pavertimas', () => {
  it('nuskaito sumą su nedalomais tarpais', () => {
    expect(suma('1 192 175,00 Eur')).toBe(1192175);
    expect(suma('1 192 175,00 Eur')).toBe(1192175);
  });

  it('tuščią reikšmę grąžina kaip null', () => {
    expect(suma('–')).toBeNull();
    expect(suma('')).toBeNull();
    expect(data('–')).toBeNull();
  });

  it('išrenka datą ir slug`ą', () => {
    expect(data('Taip (2019-05-17)')).toBe('2019-05-17');
    expect(slugas('//2014.esinvesticijos.lt/lt//x/uab-liskandas?page=2')).toBe('uab-liskandas');
  });
});

describe('2014esinvesticijos sąrašo puslapis', () => {
  const html = `
    <div class="totals"><span class="count">40795</span></div>
    <select name="evaluation_stage">
      <option value="">Visos</option>
      <option value="165">Nesudaryta sutartis</option>
    </select>
    <table><tbody>
      <tr data-href="//2014.esinvesticijos.lt/lt//finansavimas/paraiskos_ir_projektai/uab-liskandas">
        <td class="nr_col"><strong>1</strong></td>
        <td><div>UAB "Liskandas" gaminių sertifikavimas</div><div>03.2.1-LVPA-K-802-01-0058</div></td>
        <td>Uždaroji akcinė bendrovė "LISKANDAS"</td>
        <td><div class="stage_no_agreement">Nesudaryta sutartis</div></td>
        <td class="application_col">
          <dl><dt>1. Paraiškos vertinimo statusas</dt><dd>Ne (2015-06-16)</dd></dl>
          <dl><dt>2. Naudos ir kokybės vertinimas</dt><dd></dd></dl>
        </td>
        <td class="value">28 045,00 Eur</td>
        <td class="value">14 022,00 Eur</td>
        <td class="value">0,00 Eur</td>
        <td class="value">0,00 Eur</td>
        <td class="value">0,00 Eur</td>
        <td>2016-01-15</td>
      </tr>
    </tbody></table>`;

  it('nuskaito eilutę su sumomis ir sutarties data', () => {
    const { eilutes, visoIrasu } = parseSarasoPuslapi(html);

    expect(visoIrasu).toBe(40795);
    expect(eilutes).toHaveLength(1);
    expect(eilutes[0]).toMatchObject({
      kodas: '03.2.1-LVPA-K-802-01-0058',
      slug: 'uab-liskandas',
      pareiskejas: 'Uždaroji akcinė bendrovė "LISKANDAS"',
      busena: 'Nesudaryta sutartis',
      verteParaiskoje: 28045,
      prasomasFinansavimas: 14022,
      sutartiesData: '2016-01-15',
    });
  });

  it('pirmą vertinimo kriterijų vadina taip pat kaip projekto puslapis', () => {
    const { eilutes } = parseSarasoPuslapi(html);

    expect(eilutes[0].vertinimai[0]).toEqual({
      eilesNr: 1,
      kriterijus: 'Tinkamumo vertinimas',
      rezultatas: false,
      data: '2015-06-16',
    });
    expect(eilutes[0].vertinimai[1].rezultatas).toBeNull();
  });

  it('paima filtrų žodynus su šaltinio id', () => {
    expect(parseFiltrus(html).busenos).toEqual([{ id: 165, pavadinimas: 'Nesudaryta sutartis' }]);
  });
});

describe('2014esinvesticijos projekto puslapis', () => {
  const html = `
    <div class="head2"><h2>Projektas</h2><h2>Nr. 03.3.1-LVPA-K-850-01-0154</h2></div>
    <div class="right_date_block">
      <div><span>Paraiškos būsena:</span><div class="stage_finalized">Baigtas įgyvendinti</div></div>
      <div><span>Sutarties pasirašymo diena:</span>2019-12-30</div>
      <div><span>Projekto veiklų įgyvendinimo pabaiga:</span>2021-09-01</div>
    </div>
    <table class="table table-striped">
      <tr><td><strong>Savivaldybė</strong></td><td>Klaipėdos raj.</td></tr>
      <tr><td><strong>Priemonė</strong></td><td><a href="//x/patvirtintos_priemones/regio-potencialas-lt">Regio potencialas LT</a></td></tr>
      <tr><td><strong>Kvietimo kodas</strong></td><td>03.3.1-LVPA-K-850-01</td></tr>
    </table>
    <p>Projekto aprašymas.</p>
    <table class="table no_margin"><tbody>
      <tr><td>2. Naudos ir kokybės vertinimas</td><td>Taip (2019-05-17)</td><td>64.00</td></tr>
    </tbody></table>
    <table class="table no_margin"><tbody>
      <tr><td>309 000,00</td><td>200 000,00</td><td>309 000,00</td><td>200 000,00</td></tr>
    </tbody></table>
    <table class="table indicators"><tbody>
      <tr><td class="nmb">1</td><td>Įmonių skaičius</td><td>Įmonės</td><td>1.00</td><td>0</td></tr>
      <tr class="chart-tr"><td colspan="5">grafikas</td></tr>
    </tbody></table>
    <div id="related_procurenotices"><table><tr>
      <td class="head">
        <div class="date"><div><span>Paskelbimo data</span>2020-06-12</div><div><span>Terminas</span>2020-07-22</div></div>
        <a class="title" href="//x/neperkanciuju-organizaciju-pirkimu-skelbimai/kalimo-linija">Kalimo linija</a>
      </td>
    </tr></table></div>
    <div id="related_applications"><table><tbody>
      <tr data-href="//x/paraiskos_ir_projektai/kitas-projektas"><td>1</td></tr>
    </tbody></table></div>`;

  const detales = parseProjektoPuslapi(html);

  it('nuskaito laukus iš viršutinės lentelės ir datų bloko', () => {
    expect(detales).toMatchObject({
      kodas: '03.3.1-LVPA-K-850-01-0154',
      busena: 'Baigtas įgyvendinti',
      savivaldybe: 'Klaipėdos raj.',
      priemonesSlug: 'regio-potencialas-lt',
      kvietimoKodas: '03.3.1-LVPA-K-850-01',
      aprasymas: 'Projekto aprašymas.',
      sutartiesData: '2019-12-30',
      veikluPabaiga: '2021-09-01',
      apmoketosIslaidos: 309000,
      ismoketasFinansavimas: 200000,
    });
  });

  it('nuskaito vertinimo balą, rodiklius, pirkimų skelbimus ir ryšius', () => {
    expect(detales.vertinimai[0]).toMatchObject({ kriterijus: 'Naudos ir kokybės vertinimas', balas: 64 });
    expect(detales.rodikliai).toEqual([
      {
        eilesNr: 1,
        pavadinimas: 'Įmonių skaičius',
        matavimoVienetas: 'Įmonės',
        siektinaReiksme: 1,
        pasiektaReiksme: 0,
      },
    ]);
    expect(detales.pirkimuSkelbimai).toEqual([
      {
        slug: 'kalimo-linija',
        pavadinimas: 'Kalimo linija',
        paskelbimoData: '2020-06-12',
        terminas: '2020-07-22',
      },
    ]);
    expect(detales.susijeSlugai).toEqual(['kitas-projektas']);
  });
});

describe('2014esinvesticijos priemonių sąrašas', () => {
  it('praleidžia rikiavimo nuorodas', () => {
    const html = `
      <a href="//x/patvirtintos_priemones/listingItem_byPriority">Rikiuoti</a>
      <a href="//x/patvirtintos_priemones/expo-sertifikatas-lt">Expo sertifikatas LT</a>
      <a href="//x/patvirtintos_priemones/expo-sertifikatas-lt">Ta pati</a>`;

    expect(parsePriemoniuSarasa(html)).toEqual(['expo-sertifikatas-lt']);
  });
});
