/**
 * Typed wrapper around the runtime configuration loaded from the root
 * `config.js`.
 *
 * The root file has no types of its own, so this module re-exports it cast to
 * `SiteConfig` and keeps callers ergonomic. We deliberately load through the
 * runtime helper instead of importing `@/config.js` directly, because Astro's
 * server build would otherwise inline the current config values into the
 * bundle.
 *
 * Fields are marked optional where the sample config shows `undefined` or
 * comments imply the field may be absent. Only the fields actually accessed
 * from `src/` are listed; expand as new usages appear.
 */
import rawConfig from '@/utils/config.js';

export interface InfoBannerObject {
  type?: 'text' | 'html';
  content: string;
  important?: boolean;
}

export interface InfoBanner {
  type: 'text' | 'html';
  content: string;
  important: boolean;
}

export interface SiteConfig {
  /** HTML injected into every page's `<head>` (analytics snippets, custom CSS, etc.). */
  customHead?: string;
  /** External analytics URL — `/analitika` redirects here when set. */
  analitikaUrl?: string;
  /** Tor onion address advertised via header. */
  onionAddress?: string;

  /** Whether Typesense search backend is reachable. */
  typesenseUp: boolean;

  /** HTTP port the server listens on. */
  port: number;
  /** Proxy IP to trust. */
  proxyIp?: string;

  /** Compress HTML responses (production only). */
  enableMinification: boolean;
  parallelRouteLoading?: boolean;
  workerCount?: number;
  dev?: boolean;

  /** Optional banner shown at the top of every page.  String or object. */
  infoBanner?: string | InfoBannerObject;

  /** Base URL of the internal file CDN; used to build preview URLs. */
  internalFileBase: string;
  ocrBandymai?: number;

  /** Toggles the experimental vector file search page. */
  enableVectorSearch?: boolean;
  /** Backend URL used by the experimental vector file search page. */
  vectorSearchUrl?: string;
  /** Backend URL used by the experimental court judgment vector search page. */
  teismoNuosprendziaiVectorSearchUrl?: string;
  /** Toggles the prototype /dokumentai document search page. */
  enableDokumentaiSearch?: boolean;

  /** Toggles the relationship-graph feature throughout the UI. */
  enableGraph: boolean;
}

const config = rawConfig as SiteConfig;

export function normalizeInfoBanner(rawInfoBanner?: string | InfoBannerObject): InfoBanner | null {
  if (typeof rawInfoBanner === 'string' && rawInfoBanner.trim()) {
    return {
      type: 'text',
      content: rawInfoBanner.trim(),
      important: false,
    };
  }

  if (!rawInfoBanner || typeof rawInfoBanner !== 'object') {
    return null;
  }

  const type = rawInfoBanner.type === 'html' ? 'html' : 'text';
  const content = typeof rawInfoBanner.content === 'string' ? rawInfoBanner.content.trim() : '';

  if (!content) {
    return null;
  }

  return {
    type,
    content,
    important: rawInfoBanner.important === true,
  };
}

export default config;
