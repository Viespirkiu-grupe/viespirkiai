import type { APIRoute } from 'astro';
import { juridiniaiViewportPoints } from '@/modules/juridiniai/quickwitMap.js';

export const GET: APIRoute = async ({ url }) => {
  const minLat = parseFloat(url.searchParams.get('minLat') || '');
  const minLon = parseFloat(url.searchParams.get('minLon') || '');
  const maxLat = parseFloat(url.searchParams.get('maxLat') || '');
  const maxLon = parseFloat(url.searchParams.get('maxLon') || '');

  if ([minLat, minLon, maxLat, maxLon].some(Number.isNaN)) {
    return new Response('Invalid viewport bounds', { status: 400 });
  }

  const query = Object.fromEntries(url.searchParams);
  const locations = await juridiniaiViewportPoints(query, { minLat, minLon, maxLat, maxLon });

  return new Response(JSON.stringify({ locations }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, max-age=15' },
  });
};
