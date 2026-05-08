/**
 * Idempotent loader for Leaflet's CSS + JS bundle.
 *
 * The same loader body is needed in two places:
 *   - inside `customHead` of pages that use Leaflet (so the request is in flight
 *     as early as possible) — the {@link LEAFLET_HEAD} string is plugged in
 *     there;
 *   - inside individual map components rendered as fragments (e.g. detail
 *     pages where the map appears conditionally).  Those use the
 *     {@link LeafletLoader} component which embeds the same body via
 *     `set:html`.
 *
 * Exposes `window.__vpLeafletLoad()` which returns a Promise that resolves
 * when `window.L` is ready.
 */
const LEAFLET_LOADER_BODY = `(function () {
  window.__vpLeaflet = window.__vpLeaflet || { loading: null, loaded: false };
  const state = window.__vpLeaflet;
  function ensureCssOnce() {
    if (document.querySelector('link[data-vp-leaflet-css="1"]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = '/dist/leaflet.css'; link.dataset.vpLeafletCss = '1';
    document.head.appendChild(link);
  }
  function waitForLeafletGlobal(resolve) {
    const check = () => { if (window.L && window.L.map) { state.loaded = true; resolve(); } else { setTimeout(check, 25); } };
    check();
  }
  function appendScriptWhenBodyReady(scriptEl) {
    const mount = () => { const t = document.body || document.head || document.documentElement; if (!t) return false; t.appendChild(scriptEl); return true; };
    if (mount()) return;
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', () => { mount(); }, { once: true }); } else { setTimeout(() => { mount(); }, 0); }
  }
  function ensureJsOnce() {
    if (state.loaded) { state.loading = state.loading || Promise.resolve(); return state.loading; }
    if (state.loading) return state.loading;
    state.loading = new Promise((resolve, reject) => {
      if (document.querySelector('script[data-vp-leaflet-js="1"]')) { return waitForLeafletGlobal(resolve); }
      const script = document.createElement('script');
      script.src = '/dist/leaflet.js'; script.defer = true; script.dataset.vpLeafletJs = '1';
      script.onload = () => { state.loaded = true; resolve(); }; script.onerror = reject;
      appendScriptWhenBodyReady(script);
    });
    return state.loading;
  }
  window.__vpLeafletLoad = window.__vpLeafletLoad || function () { ensureCssOnce(); return ensureJsOnce(); };
  try { window.__vpLeafletLoad(); } catch (e) {}
})();`;

/** HTML snippet to inject into Layout's `customHead` for pages using Leaflet. */
export const LEAFLET_HEAD = `<script defer>\n${LEAFLET_LOADER_BODY}\n<\/script>`;

/** Bare loader body (no `<script>` wrapper) — used by the `<LeafletLoader />` component. */
export const LEAFLET_LOADER_SCRIPT = LEAFLET_LOADER_BODY;
