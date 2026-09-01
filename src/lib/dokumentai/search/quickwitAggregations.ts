import { QW_URL } from '@/quickwit/qwHttp.js';
import type { FacetOption } from './types.ts';
import { canonSource } from './query.ts';

export const DOKUMENTAI_INDEX = 'documents';

export async function fetchAggregations(
  query: string,
  aggs: Record<string, unknown>,
): Promise<Response> {
  return fetch(`${QW_URL}/api/v1/${DOKUMENTAI_INDEX}_*/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, max_hits: 0, aggs, format: 'json' }),
  });
}

export async function qwAggregate(
  field: string,
  query: string,
  size: number,
): Promise<FacetOption[]> {
  try {
    const response = await fetchAggregations(query, {
      values: { terms: { field, size } },
    });
    if (!response.ok) return [];
    const data: any = await response.json();
    return (data?.aggregations?.values?.buckets ?? []).map((bucket: any) => ({
      value: String(bucket.key),
      count: Number(bucket.doc_count),
    }));
  } catch {
    return [];
  }
}

export function aggregationOptions(
  aggregations: any,
  key: string,
  scale: (count: number) => number = (count) => count,
): FacetOption[] {
  return (aggregations?.[key]?.buckets ?? [])
    .filter((bucket: any) => bucket.key !== '' && bucket.key != null)
    .map((bucket: any) => ({
      value: String(bucket.key),
      count: scale(Number(bucket.doc_count)),
    }));
}

/** Merge source buckets whose fast-field normalizers produced different casing. */
export function mergeSourceBuckets(
  buckets: any[] | undefined,
  scale: (count: number) => number = (count) => count,
): FacetOption[] {
  const counts = new Map<string, number>();
  for (const bucket of buckets ?? []) {
    const rawValue = bucket.value ?? bucket.key;
    if (!rawValue) continue;
    const value = canonSource(String(rawValue));
    const count = Number(bucket.count ?? bucket.doc_count ?? 0);
    counts.set(value, (counts.get(value) ?? 0) + count);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count: scale(count) }))
    .sort((left, right) => (right.count ?? 0) - (left.count ?? 0));
}
