// Akto teksto stulpelis: pilno ekrano aukščio, nejudantis slenkant, o pasiekus
// puslapio apačią — atsisėdantis ties poraštę.
//
// Kodėl ne `position: sticky`: html ir body turi `overflow-x: hidden`
// (reset.css), tad slinkties konteineriu tampa body ir sticky elementas
// nepakimba (ta pati priežastis aprašyta bvpz.css „atvirkštinio sticky"
// komentare). Todėl kabėjimą neša `position: fixed`, o vietą groteles rezervuoja
// tuščias stulpelio langelis.
//
// Kadras: `top` = antraštės aukštis, `height` = likęs langas, `left/width` —
// nuo grotelių langelio, kad plotis sutaptų su 50/50 skiltimi. Kai grotelių
// apačia pakyla virš rėmo apačios, `top` skaičiuojamas nuo jos — rėmas
// nebeužlipa ant poraštės.

// Rėmas prigludęs: viršuje prie antraštės, apačioje prie lango krašto, dešinėje
// iki pat ekrano krašto — jokių kelių pikselių plyšių.
const TARPAS_VIRSUJE = 0;
const TARPAS_APACIOJE = 0;

export function initTeisesAktoTekstoStulpelis() {
  const cell = document.querySelector<HTMLElement>('.ta-text-col');
  const panel = cell?.querySelector<HTMLElement>('.ta-panel');
  const grid = document.querySelector<HTMLElement>('.ta-grid');
  if (!cell || !panel || !grid) return;

  // Riba sutampa su puslapio CSS lūžiu: siaurame ekrane maketas vienastulpelis,
  // tekstas eina paprastu srautu.
  const mq = window.matchMedia('(min-width: 1101px)');
  const header = document.querySelector<HTMLElement>('.site-header-shell');

  const update = () => {
    if (!mq.matches) {
      panel.classList.remove('is-fixed');
      panel.removeAttribute('style');
      cell.style.removeProperty('height');
      return;
    }

    const virsus = (header?.offsetHeight ?? 0) + TARPAS_VIRSUJE;
    const aukstis = window.innerHeight - virsus - TARPAS_APACIOJE;
    const langelis = cell.getBoundingClientRect();
    const groteliuApacia = grid.getBoundingClientRect().bottom;

    // Įprastai rėmas kabo ties antraštę; puslapio gale — pakyla kartu su
    // grotelių apačia, tad prieš poraštę jis tiesiog atsisėda.
    const y = Math.min(virsus, groteliuApacia - aukstis);

    // Plotis — nuo langelio kairės iki lango krašto: `main` šoninė paraštė
    // dešinėje rėmui nereikalinga, ten jis tik paliktų tuščią juostelę.
    const plotis = document.documentElement.clientWidth - langelis.left;

    cell.style.height = `${aukstis}px`;
    panel.classList.add('is-fixed');
    panel.style.top = `${y}px`;
    panel.style.left = `${langelis.left}px`;
    panel.style.width = `${plotis}px`;
    panel.style.height = `${aukstis}px`;
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
  mq.addEventListener('change', update);
  // Antraštė keičia aukštį (info juosta, siauras ekranas) — sekam ir ją.
  if (header) new ResizeObserver(update).observe(header);
}
