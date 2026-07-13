import type { APIRoute } from 'astro';
import { fetchTileCells } from '@/src/lib/mapTiles.ts';

export const GET: APIRoute = async ({ params }) => {
  const z = parseInt(params.z!);
  const x = parseInt(params.x!);
  const y = parseInt(params.y!);

  const cells = await fetchTileCells('jar', z, x, y);

  return new Response(JSON.stringify({ cells }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
