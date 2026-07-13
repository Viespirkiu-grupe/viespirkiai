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

// Client-side heatmap overlay. Fetches aggregated cell counts as JSON from a
// `{z}/{x}/{y}.json` tile endpoint and paints each 256px tile onto a <canvas>,
// mirroring the old server-side PNG worker exactly (16×16 grid of 16px cells,
// per-tile log-scaled red intensity). `urlTemplate` uses {z}/{x}/{y} placeholders.
export function createHeatmapLayer(L: any, urlTemplate: string, options: any = {}) {
  const TILE_SIZE = 256;
  const SCALE = 16;
  const CELL = TILE_SIZE / SCALE;

  const HeatmapLayer = L.GridLayer.extend({
    createTile(coords: any, done: any) {
      const tile = document.createElement('canvas');
      tile.width = TILE_SIZE;
      tile.height = TILE_SIZE;
      const ctx = tile.getContext('2d');

      const url = urlTemplate.replace(/\{(\w+)\}/g, (_: any, key: string) => {
        return String(coords[key] ?? '');
      });
      fetch(url)
        .then((response) => response.json())
        .then((data) => {
          const cells = data.cells || [];
          if (ctx && cells.length > 0) {
            let maxCount = 1;
            for (const cell of cells) if (cell[2] > maxCount) maxCount = cell[2];
            const denom = Math.log10(maxCount + 1);
            for (const [dx, dy, count] of cells) {
              const intensity = Math.log10(count + 1) / denom;
              const green = Math.round(255 * (1 - intensity));
              const alpha = Math.floor(255 * Math.min(Math.max(intensity, 0), 1)) / 255;
              ctx.fillStyle = `rgba(255, ${green}, 0, ${alpha})`;
              ctx.fillRect(dx * CELL, dy * CELL, CELL, CELL);
            }
          }
          done(null, tile);
        })
        .catch((err) => done(err, tile));

      return tile;
    },
  });

  return new HeatmapLayer({ tileSize: TILE_SIZE, ...options });
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
