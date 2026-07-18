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
 * The shared contract lives next to the runtime loader in `utils/config.d.ts`.
 */
import rawConfig from '@/utils/config.js';
import type { Config } from '@/utils/config.js';

/** Informacinio banerio forma (šaltinis – DB lentelė `infoBaneris`, žr. infoBanner.ts). */
export interface InfoBanner {
  type: 'text' | 'html';
  content: string;
  important: boolean;
}

const config: Config = rawConfig;

export default config;
