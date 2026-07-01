// Shared client-side coordinator for the /dokumentai page. Holds the single
// live copy of the query string that every filter component mutates, plus the
// debounced navigation and the list get/set helpers. The Dok* component
// `<script>`s import from here so their behaviour stays co-located with their
// markup while still sharing one query-string state.

// One live, in-memory copy of the query string. Every filter click mutates
// THIS — not a server-precomputed href — so rapid toggles accumulate instead
// of clobbering each other (clicking B no longer drops the A you just set).
export const params = new URLSearchParams(window.location.search);

let navTimer: ReturnType<typeof setTimeout> | undefined;

export function showLoading() {
  document.getElementById('dokContent')?.classList.add('is-loading');
}

// Navigate to the accumulated state. Debounced so a flurry of toggles
// collapses into a single reload; `immediate` skips the wait.
export function navigate(immediate = false) {
  showLoading();
  clearTimeout(navTimer);
  const go = () => { window.location.href = '/dokumentai?' + params.toString(); };
  if (immediate) go();
  else navTimer = setTimeout(go, 350);
}

// Multi-valued params: author/creator/producer repeat the key; everything else
// is a single comma-joined value.
export function setList(param: string, list: string[]) {
  params.delete(param);
  if (param === 'author' || param === 'creator' || param === 'producer') {
    list.forEach((value) => params.append(param, value));
  } else if (list.length) {
    params.set(param, list.join(','));
  }
}
export function getList(param: string) {
  if (param === 'author' || param === 'creator' || param === 'producer') return params.getAll(param).filter(Boolean);
  return (params.get(param) || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Registry so the sidebar's "Daugiau" buttons (DokFilters) can open the facet
// "show all" modal that lives in DokFacetModal, without either importing the
// other. DokFacetModal replaces `open` on init.
export const facetModal: { open: (opts: { field: string; param: string; title: string }) => void } = {
  open: () => {},
};
