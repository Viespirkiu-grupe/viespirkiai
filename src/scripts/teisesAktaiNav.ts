// Bendras /teisesAktai kliento koordinatorius: viena gyva query string'o kopija,
// kurią keičia visi filtrai, plius atidėta navigacija. Toks pat modelis kaip
// /dokumentai (scripts/dokumentaiNav.ts) — filtro paspaudimas keičia ŠITĄ būseną,
// o ne serveryje suskaičiuotą href'ą, tad greiti keli paspaudimai sudedami, o ne
// vienas kitą užtrina.
export const params = new URLSearchParams(window.location.search);

let navTimer: ReturnType<typeof setTimeout> | undefined;

export function showLoading() {
  document.getElementById('taContent')?.classList.add('is-loading');
}

export function navigate(immediate = false) {
  showLoading();
  clearTimeout(navTimer);
  const go = () => { window.location.href = '/teisesAktai?' + params.toString(); };
  if (immediate) go();
  else navTimer = setTimeout(go, 350);
}

/** Institucijų / EUROVOC / ryšių reikšmėse pasitaiko kablelių → kartojam raktą. */
const REPEATED = new Set(['prieme', 'eurovoc', 'rysys']);

export function setList(param: string, list: string[]) {
  params.delete(param);
  if (REPEATED.has(param)) list.forEach((value) => params.append(param, value));
  else if (list.length) params.set(param, list.join(','));
}

export function getList(param: string) {
  if (REPEATED.has(param)) return params.getAll(param).filter(Boolean);
  return (params.get(param) || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Registras, kad juostos „Daugiau" mygtukai (TaFilters) galėtų atidaryti
// „rodyti visus" modalą, gyvenantį TaFacetModal — nė vienam nereikia importuoti
// kito. TaFacetModal inicijuodamasis pakeičia `open`.
export const facetModal: {
  open: (opts: {
    field: string;
    param: string;
    title: string;
    formatLabel?: (v: string) => string;
    /** Ilgoms reikšmėms — mažiau, bet platesnių stulpelių. */
    wide?: boolean;
  }) => void;
} = {
  open: () => {},
};
