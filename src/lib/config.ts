/**
 * Typed wrapper around the runtime configuration loaded from `@/config.js`.
 *
 * The underlying JavaScript file (root `config.js`, copied from
 * `config.sample.js` at deploy time) has no types of its own.  This module
 * imports it once and re-exports it cast to a typed `SiteConfig`, so callers
 * can write `config.customHead` instead of `(config as any).customHead`.
 *
 * Fields are marked optional where the sample config shows `undefined` or
 * comments imply the field may be absent.  Only the fields actually accessed
 * from `src/` are listed; expand as new usages appear.
 */
import rawConfig from '@/config.js';

export interface InfoBannerObject {
  type?: 'text' | 'html';
  content: string;
  important?: boolean;
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

  /** Toggles the relationship-graph feature throughout the UI. */
  enableGraph: boolean;
}

const config = rawConfig as SiteConfig;

export default config;
