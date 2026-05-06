/// <reference types="astro/client" />

export {};

declare global {
  interface Window {
    L?: {
      map: unknown;
      tileLayer: (...args: unknown[]) => unknown;
      marker: (...args: unknown[]) => unknown;
    };
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
