import config from './config.ts';

export interface VectorSearchResult {
  remote_id: string | number | null;
  text: string;
  similarity: number;
}

export function normalizeVectorSearchResults(payload: unknown): VectorSearchResult[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { results?: unknown[] })?.results)
      ? (payload as { results: unknown[] }).results
      : Array.isArray((payload as { data?: unknown[] })?.data)
        ? (payload as { data: unknown[] }).data
        : [];

  return rows.map((row: any) => ({
    remote_id: row?.remote_id ?? row?.remoteId ?? row?.id ?? null,
    text: typeof row?.text === 'string' ? row.text : '',
    similarity: Number(row?.similarity ?? row?.score ?? 0),
  }));
}

export async function fetchVectorSearchResults(search: string): Promise<VectorSearchResult[]> {
  const trimmed = search.trim();
  if (!trimmed) return [];

  if (!config.vectorSearchUrl) {
    throw new Error('Nenurodytas vectorSearchUrl config.js faile.');
  }

  const upstreamUrl = new URL(config.vectorSearchUrl);
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
