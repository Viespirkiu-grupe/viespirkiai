declare global {
  interface Window {
    L?: any;
    ensureLeafletRuntime?: () => Promise<void>;
    __vpLeaflet?: {
      loading: Promise<void> | null;
      loaded: boolean;
    };
    __vpLeafletLoad?: () => Promise<void>;
  }
}

function ensureCssOnce() {
  if (document.querySelector('link[data-vp-leaflet-css="1"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/dist/leaflet.css';
  link.dataset.vpLeafletCss = '1';
  document.head.appendChild(link);
}

function waitForLeafletGlobal(resolve: () => void) {
  const check = () => {
    if (window.L && window.L.map) {
      if (window.__vpLeaflet) window.__vpLeaflet.loaded = true;
      resolve();
    } else {
      setTimeout(check, 25);
    }
  };
  check();
}

function appendScriptWhenBodyReady(scriptEl: HTMLScriptElement) {
  const mount = () => {
    const target = document.body || document.head || document.documentElement;
    if (!target) return false;
    target.appendChild(scriptEl);
    return true;
  };
  if (mount()) return;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      mount();
    }, { once: true });
  } else {
    setTimeout(() => {
      mount();
    }, 0);
  }
}

export function ensureLeafletRuntime() {
  window.__vpLeaflet = window.__vpLeaflet || { loading: null, loaded: false };
  const state = window.__vpLeaflet;

  if (state.loaded) return Promise.resolve();
  if (state.loading) return state.loading;

  ensureCssOnce();

  state.loading = new Promise<void>((resolve, reject) => {
    if (document.querySelector('script[data-vp-leaflet-js="1"]')) {
      waitForLeafletGlobal(resolve);
      return;
    }

    const script = document.createElement('script');
    script.src = '/dist/leaflet.js';
    script.defer = true;
    script.dataset.vpLeafletJs = '1';
    script.onload = () => {
      state.loaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Leaflet'));
    appendScriptWhenBodyReady(script);
  });

  return state.loading;
}

if (typeof window !== 'undefined') {
  window.ensureLeafletRuntime = ensureLeafletRuntime;
  window.__vpLeafletLoad = window.__vpLeafletLoad || ensureLeafletRuntime;
}
