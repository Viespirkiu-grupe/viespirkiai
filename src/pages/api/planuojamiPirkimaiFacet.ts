import type { APIRoute } from 'astro';
import {
  BVPZ_PARAM, PIRKEJAS_PARAM, bvpzFacetOptions, pirkejasFacetOptions, planuojamiContext,
} from '../../lib/planuojamiPirkimai.ts';

// Pilnas vieno planuojamų pirkimų facetų lauko reikšmių sąrašas pagal esamą
// užklausą/filtrus. Maitina „Daugiau" dialogus šoninėje juostoje — grąžina
// daugiau reikšmių nei juostos peržiūra, plius paiešką pagal kodą ar pavadinimą.
//
// `bvpzKodai` pavadinimas paliktas toks pat kaip /sutartys, nes tą patį lauko
// vardą siunčia bendras BvpzFacetTreeModal.
const FIELDS: Record<string, typeof bvpzFacetOptions> = {
  bvpzKodai: bvpzFacetOptions,
  [BVPZ_PARAM]: bvpzFacetOptions,
  [PIRKEJAS_PARAM]: pirkejasFacetOptions,
};

export const GET: APIRoute = async ({ url }) => {
  const params = url.searchParams;
  const field = params.get('field')?.trim() || '';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  const loader = FIELDS[field];
  if (!loader) return json({ options: [] }, 400);

  const size = Math.min(2000, Math.max(1, parseInt(params.get('size') || '1000', 10) || 1000));
  const optionSearch = params.get('optionSearch')?.trim() || '';

  try {
    const ctx = await planuojamiContext(url);
    return json({ options: await loader(ctx, { size, optionSearch }) });
  } catch (error) {
    return json({ options: [], error: String(error) }, 500);
  }
};
