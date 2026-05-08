import type { APIRoute } from 'astro';
import { postgres } from '../../lib/failai.js';

export const GET: APIRoute = async () => {
  const { rows } = await postgres.query(
    'SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lon FROM public.failai WHERE location IS NOT NULL'
  );

  const points = (rows as any[]).map((row) => [Number(row.lat), Number(row.lon)]);

  return new Response(JSON.stringify({ points }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
