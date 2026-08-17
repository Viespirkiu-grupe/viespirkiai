/**
 * Compatibility facade for document search.
 *
 * Implementations live in `./dokumentai/search` so existing server, page and
 * test imports can continue using this stable public module.
 */
export * from './dokumentai/search/types.ts';
export * from './dokumentai/search/query.ts';
export * from './dokumentai/search/facets.ts';
export * from './dokumentai/search/statistics.ts';
export { searchDokumentai } from './dokumentai/search/search.ts';
export { foldLithuanian, makeSnippet, normalizeDocText } from './dokumentai/snippet.ts';
