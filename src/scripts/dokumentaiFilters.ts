// Sidebar behaviour for DokFilters: optimistic filter toggles, the add-by-text
// forms, the mobile collapse, the "Daugiau" buttons (inline reveal or the shared
// facet modal) and the search form (intercepted so active filters survive the
// submit). Imported once by DokFilters; coordinates through dokumentaiNav.

import { params, navigate, getList, setList, showLoading, facetModal } from './dokumentaiNav.ts';

// Remember each checkbox's true (server-rendered) state for THIS url, so an
// optimistic toggle can't leak into the back/forward cache snapshot.
const initialSelected = new WeakMap<Element, boolean>();
document.querySelectorAll('.dok-filter-opt').forEach((o) =>
  initialSelected.set(o, o.classList.contains('is-selected')));
window.addEventListener('pagehide', () => {
  document.querySelectorAll('.dok-filter-opt').forEach((o) =>
    o.classList.toggle('is-selected', !!initialSelected.get(o)));
  document.getElementById('dokContent')?.classList.remove('is-loading');
});
// Clear the veil if the page is restored from the back/forward cache.
window.addEventListener('pageshow', () => {
  document.getElementById('dokContent')?.classList.remove('is-loading');
});

// Optimistic toggle: flip the clicked filter's checkbox instantly so the
// change is visible during the round-trip. Mirrors the "Visi"/specific
// interplay within a section.
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
    if (!param) return;            // no JS metadata → fall back to the href
    e.preventDefault();
    params.delete('page');
    if (a.classList.contains('dok-filter-all')) {
      params.delete(param);       // "Visi" clears the section
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

// Mobile: the "Filtrai" header collapses/expands the facet panel so results
// stay near the top. No-op visual on desktop (sections are always shown).
const filtersToggle = document.getElementById('dokFiltersToggle');
const dokSidebar = document.getElementById('dokSidebar');
filtersToggle?.addEventListener('click', () => {
  const open = dokSidebar?.classList.toggle('is-open') ?? false;
  filtersToggle.setAttribute('aria-expanded', String(open));
});

function wireAddForm(formId: string, inputId: string, param: string, transform = (s: string) => s) {
  const form = document.getElementById(formId) as HTMLFormElement | null;
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const val = transform((input?.value ?? '').trim());
    if (!val) return;
    const list = getList(param);
    if (!list.includes(val)) list.push(val);
    setList(param, list);
    params.delete('page');
    navigate(true);
  });
}
wireAddForm('dok-host-form', 'dok-host-input', 'host', (s) => s.toLowerCase());
wireAddForm('dok-jar-form', 'dok-jar-input', 'jar');
// Plėtinio savo įvedimas dabar gyvena „Daugiau" modale, ne sidebar'e.

document.querySelectorAll<HTMLButtonElement>('.dok-more-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    // Facets with a `data-facet-modal` open the full-screen "show all" modal
    // (huge list + custom entry) instead of the inline reveal.
    if (btn.dataset.facetModal) {
      facetModal.open({
        field: btn.dataset.facetModal,
        param: btn.dataset.facetParam || '',
        title: btn.dataset.facetTitle || 'Filtras',
      });
      return;
    }
    const more = btn.previousElementSibling as HTMLElement | null;
    if (!more || !more.classList.contains('dok-more-list')) return;
    more.hidden = false;
    btn.remove();
  });
});

// The search form is a bare GET form (only the text input), so a native submit
// would drop every active filter. Intercept it and navigate via the live
// `params` instead, which already carries all the facet selections. (On the
// empty-search home there are no filters, so its form submits natively.)
// Įrašo dabar pasirinktą paieškos režimą (Žodžiai / Tiksli frazė) į `params`.
function syncMode() {
  const checked = document.querySelector<HTMLInputElement>('input[name="mode"]:checked');
  params.set('mode', checked?.value === 'words' ? 'words' : 'phrase');
}

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

// Perjungus režimą iš karto perleidžiam paiešką (jei jau yra užklausa), kaip ir
// su filtrais. Be užklausos – tik įsimenam pasirinkimą kitam pateikimui.
document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    syncMode();
    params.delete('page');
    if (params.get('search') || params.get('q')) navigate(true);
  });
});
