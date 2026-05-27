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
import type { Config, InfoBannerObject } from '@/utils/config.js';

export interface InfoBanner {
  type: 'text' | 'html';
  content: string;
  important: boolean;
}

const config: Config = rawConfig;

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
