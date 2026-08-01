import type { APIRoute } from 'astro';
import { juridiniaiFacetOptions } from '@/modules/juridiniai/searchQuickwit.js';

const ALLOWED = new Set([
  'formosPavadinimas',
  'statusoPavadinimas',
  'evrkKodas',
  'apskritis',
  'savivaldybe',
]);

export const GET: APIRoute = async ({ url }) => {
  const field = url.searchParams.get('field')?.trim() || '';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });

  if (!ALLOWED.has(field)) return json({ options: [] }, 400);

  const size = Math.min(2000, Math.max(1, parseInt(url.searchParams.get('size') || '1000', 10) || 1000));
  const optionSearch = url.searchParams.get('optionSearch')?.trim() || '';
  const query = Object.fromEntries(url.searchParams.entries());

  try {
    const options = await juridiniaiFacetOptions(field, query, size, optionSearch);
    return json({ options });
  } catch (error) {
    console.error('Juridinių facetų dialogo klaida', error);
    return json({ options: [] }, 500);
  }
};
