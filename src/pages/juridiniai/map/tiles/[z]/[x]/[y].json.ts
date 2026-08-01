import type { APIRoute } from 'astro';
import { juridiniaiTileCells } from '@/modules/juridiniai/quickwitMap.js';

export const GET: APIRoute = async ({ params, url }) => {
  const z = parseInt(params.z!);
  const x = parseInt(params.x!);
  const y = parseInt(params.y!);

  if (![z, x, y].every(Number.isInteger) || z < 0 || z > 15) {
    return new Response('Invalid tile', { status: 400 });
  }
  const query = Object.fromEntries(url.searchParams);
  const cells = await juridiniaiTileCells(query, z, x, y);

  return new Response(JSON.stringify({ cells }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'private, max-age=30',
    },
  });
};
