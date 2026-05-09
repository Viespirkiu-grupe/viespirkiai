// `.js` shim used by callers that import `./failai.js` (the historical name).
// Astro's runtime resolves `.js` specifiers when the corresponding `.ts`
// file is the actual source, but a few legacy import paths still hard-code
// the `.js` extension; this thin re-export keeps them working without
// duplicating the implementation.
export * from './failai.ts';
