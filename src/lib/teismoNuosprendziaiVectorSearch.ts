import config from './config.ts';
import { normalizeVectorSearchResults, type VectorSearchResult } from './vectorSearch.ts';

export type { VectorSearchResult } from './vectorSearch.ts';

export async function fetchTeismoNuosprendziaiVectorSearchResults(search: string): Promise<VectorSearchResult[]> {
  const trimmed = search.trim();
  if (!trimmed) return [];

  if (!config.teismoNuosprendziaiVectorSearchUrl) {
    throw new Error('Nenurodytas teismoNuosprendziaiVectorSearchUrl config.js faile.');
  }

  const upstreamUrl = new URL(config.teismoNuosprendziaiVectorSearchUrl);
  upstreamUrl.searchParams.set('q', trimmed);

  const response = await fetch(upstreamUrl, {
    signal: AbortSignal.timeout(180000),
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Upstream klaida: ${response.status}`);
  }

  return normalizeVectorSearchResults(await response.json());
}
