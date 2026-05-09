/// <reference types="astro/client" />

export {};

declare global {
  interface Window {
    RYSIAI_CONFIG: { entityType: string; entityId: string };
    L?: any;
    __vpLeaflet?: {
      loading: Promise<void> | null;
      loaded: boolean;
    };
    __vpLeafletLoad?: () => Promise<void>;
  }
}

declare module 'jsdom' {
  export const JSDOM: any;
}
