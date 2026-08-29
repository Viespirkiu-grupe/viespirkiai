import type { APIRoute } from 'astro';
import { fetchTileCells } from '@/src/lib/mapTiles.ts';
import { buildPartsExcluding, buildPartsOpts } from '@/src/lib/dokumentai/search/query.ts';

export const GET: APIRoute = async ({ params, url }) => {
  const z = parseInt(params.z!);
  const x = parseInt(params.x!);
  const y = parseInt(params.y!);

  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 15) {
    return new Response('Invalid tile', { status: 400 });
  }

  // Tie patys paieškos parametrai, kaip ir rezultatų sąraše — taip šiluminis
  // žemėlapis rodo filtruotą rinkinį. Be parametrų gaunam „*", t. y. visus.
  const input = Object.fromEntries(url.searchParams) as Record<string, string>;
  const query = buildPartsExcluding(buildPartsOpts(input));

  const cells = await fetchTileCells('dokumentai', z, x, y, query);

  return new Response(JSON.stringify({ cells }), {
    headers: {
      'Content-Type': 'application/json',
      // Rezultatas priklauso nuo užklausos, todėl nebekešuojam viešai ilgam.
      'Cache-Control': 'private, max-age=30',
    },
  });
};
