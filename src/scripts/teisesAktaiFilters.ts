// Šoninės juostos elgsena /teisesAktai: optimistiniai filtrų perjungimai,
// „Rodyti daugiau" atskleidimas, mobilus suskleidimas ir paieškos formos
// perėmimas (kad pateikus užklausą aktyvūs filtrai neišgaruotų).
// Analogiška dokumentaiFilters.ts, tik be modalų ir be įvedimo formų.

import { params, navigate, getList, setList, showLoading, facetModal } from './teisesAktaiNav.ts';
import { LABEL_BY_PARAM } from '../lib/teisesAktaiLabels.ts';

// Serverio atiduota kiekvieno langelio būsena ŠIAM url'ui, kad optimistinis
// perjungimas nenutekėtų į back/forward cache momentinę kopiją.
const initialSelected = new WeakMap<Element, boolean>();
document.querySelectorAll('.dok-filter-opt').forEach((o) =>
  initialSelected.set(o, o.classList.contains('is-selected')));
window.addEventListener('pagehide', () => {
  document.querySelectorAll('.dok-filter-opt').forEach((o) =>
    o.classList.toggle('is-selected', !!initialSelected.get(o)));
  document.getElementById('taContent')?.classList.remove('is-loading');
});
window.addEventListener('pageshow', () => {
  document.getElementById('taContent')?.classList.remove('is-loading');
});

// Optimistinis perjungimas: paspaustą langelį perjungiam iš karto, kad pokytis
// matytųsi dar vykstant serverio kelionei.
function optimisticToggle(opt: Element) {
  const section = opt.closest('.dok-filter-section');
  if (!section) return;
  const all = section.querySelector('.dok-filter-all');
  const opts = Array.from(section.querySelectorAll('.dok-filter-opt'));
  if (opt.classList.contains('dok-filter-all')) {
    opts.forEach((o) => o.classList.toggle('is-selected', o === opt));
    return;
  }
  opt.classList.toggle('is-selected');
  all?.classList.remove('is-selected');
  const anySpecific = opts.some(
    (o) => !o.classList.contains('dok-filter-all') && o.classList.contains('is-selected'),
  );
  if (!anySpecific) all?.classList.add('is-selected');
}

document.querySelectorAll<HTMLAnchorElement>('.dok-filter-opt[href]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const param = a.dataset.param;
    if (!param) return;            // be JS metaduomenų — lieka paprastas href
    e.preventDefault();
    params.delete('page');
    if (a.classList.contains('dok-filter-all')) {
      params.delete(param);        // „Visi" nuvalo sekciją
    } else {
      const val = a.dataset.value ?? '';
      const list = getList(param);
      const i = list.indexOf(val);
      if (i >= 0) list.splice(i, 1); else list.push(val);
      setList(param, list);
    }
    optimisticToggle(a);
    navigate();
  });
});
document.querySelector('.dok-sidebar-clear')?.addEventListener('click', showLoading);

// Mobilioje versijoje antraštė suskleidžia/išskleidžia facetus.
const filtersToggle = document.getElementById('taFiltersToggle');
const sidebar = document.getElementById('taSidebar');
filtersToggle?.addEventListener('click', () => {
  const open = sidebar?.classList.toggle('is-open') ?? false;
  filtersToggle.setAttribute('aria-expanded', String(open));
});

document.querySelectorAll<HTMLButtonElement>('.dok-more-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    // Facetai su `data-facet-modal` atidaro viso ekrano „rodyti visus" langą
    // (šimtai reikšmių + paieška) vietoj išskleidimo juostoje.
    if (btn.dataset.facetModal) {
      const param = btn.dataset.facetParam || '';
      facetModal.open({
        field: btn.dataset.facetModal,
        param,
        title: btn.dataset.facetTitle || 'Filtras',
        formatLabel: LABEL_BY_PARAM[param],
        wide: btn.dataset.facetWide === '1',
      });
      return;
    }
    const more = btn.previousElementSibling as HTMLElement | null;
    if (!more || !more.classList.contains('dok-more-list')) return;
    more.hidden = false;
    btn.remove();
  });
});

// Numerių laukai („Įstaigos suteiktas numeris", „Registracijos numeris") —
// paprasti įvedimai, keliaujantys į tą pačią `params` būseną. Tuščia reikšmė
// filtrą nuima.
function setParam(name: string, value: string) {
  const v = value.trim();
  if (v) params.set(name, v); else params.delete(name);
  params.delete('page');
}

document.querySelectorAll<HTMLFormElement>('form[data-ta-text-filter]').forEach((form) => {
  const input = form.querySelector<HTMLInputElement>('input[name]');
  if (!input) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    setParam(input.name, input.value);
    navigate(true);
  });
  // Išėjus iš lauko taip pat pritaikom — kitaip įrašyta reikšmė tyliai dingtų.
  input.addEventListener('blur', () => {
    if (input.value.trim() === (new URLSearchParams(window.location.search).get(input.name) ?? '')) return;
    setParam(input.name, input.value);
    navigate();
  });
});

/** Paieškos režimas (Žodžiai / Tiksli frazė) į `params`. */
function syncMode() {
  const checked = document.querySelector<HTMLInputElement>('input[name="mode"]:checked');
  params.set('mode', checked?.value === 'phrase' ? 'phrase' : 'words');
}

// Paieškos forma yra paprastas GET, tad natūralus pateikimas numestų visus
// filtrus. Perimam ir einam per `params`, kur atranka jau surinkta.
document.getElementById('searchForm')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const val = (document.getElementById('search') as HTMLInputElement | null)?.value.trim() ?? '';
  if (val) params.set('search', val);
  else params.delete('search');
  params.delete('q');
  params.delete('page');
  syncMode();
  navigate(true);
});

document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    syncMode();
    params.delete('page');
    if (params.get('search') || params.get('q')) navigate(true);
  });
});
