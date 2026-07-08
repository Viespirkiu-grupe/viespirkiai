import type { APIRoute } from 'astro';
import { sutartysFacetOptions } from '@/modules/sutartys/searchSutartys.js';

// Pilnas vieno sutarčių facetų lauko (pirkėjo/tiekėjo kodo) reikšmių sąrašas
// pagal esamą užklausą/filtrus. Maitina „Daugiau" dialogą šoninėje juostoje —
// grąžina daug daugiau reikšmių nei sidebar'o peržiūra, plius registro paiešką.
const ALLOWED = new Set(['perkanciosiosOrganizacijosKodas', 'tiekejaiKodai', 'bvpzKodai']);

export const GET: APIRoute = async ({ url }) => {
  const p = url.searchParams;
  const field = p.get('field')?.trim() || '';
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  if (!ALLOWED.has(field)) return json({ options: [] }, 400);

  const size = Math.min(2000, Math.max(1, parseInt(p.get('size') || '1000', 10) || 1000));
  const optionSearch = p.get('optionSearch')?.trim() || '';

  // Visi paieškos/filtro parametrai lemia užklausos apimtį — perduodam kaip yra
  // (buildSutartysQuickwitQuery paima tik jam reikalingus raktus).
  const query = Object.fromEntries(p.entries());

  try {
    const options = await sutartysFacetOptions(
      field as 'perkanciosiosOrganizacijosKodas' | 'tiekejaiKodai' | 'bvpzKodai',
      query,
      size,
      optionSearch,
    );
    return json({ options });
  } catch (err) {
    return json({ options: [], error: String(err) }, 500);
  }
};
