import type { APIRoute } from 'astro';
import { postgres } from '@/postgres/postgres.js';

export const GET: APIRoute = async ({ url }) => {
  const minLat = parseFloat(url.searchParams.get('minLat') || '');
  const minLon = parseFloat(url.searchParams.get('minLon') || '');
  const maxLat = parseFloat(url.searchParams.get('maxLat') || '');
  const maxLon = parseFloat(url.searchParams.get('maxLon') || '');

  if ([minLat, minLon, maxLat, maxLon].some(Number.isNaN)) {
    return new Response('Invalid viewport bounds', { status: 400 });
  }

  const { rows } = await postgres.query(
    `SELECT DISTINCT ST_Y(location) AS lat, ST_X(location) AS lon
     FROM public."jarCsv"
     WHERE location IS NOT NULL
       AND ST_X(location) BETWEEN $1 AND $2
       AND ST_Y(location) BETWEEN $3 AND $4`,
    [minLon, maxLon, minLat, maxLat],
  );

  return new Response(JSON.stringify({ locations: rows.map((r: any) => [r.lat, r.lon]) }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
