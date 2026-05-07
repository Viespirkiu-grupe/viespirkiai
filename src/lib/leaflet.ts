export const LEAFLET_HEAD = `<script defer>
(function () {
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
})();
<\/script>`;
