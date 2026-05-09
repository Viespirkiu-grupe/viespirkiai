import type { APIRoute } from 'astro';
import { findSingleJuridinis } from '@/modules/juridiniai/search.js';

export const GET: APIRoute = async ({ url }) => {
  const q = url.searchParams.get('q');
  const similarityThreshold = url.searchParams.get('similarityThreshold');

  if (!q) {
    return new Response(JSON.stringify({ error: 'Missing query parameter: q' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const result = await findSingleJuridinis(q, {
    similarityThreshold: similarityThreshold ? Number(similarityThreshold) : undefined,
  });

  if (!result) {
    return new Response('null', { status: 404, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json' },
  });
};
