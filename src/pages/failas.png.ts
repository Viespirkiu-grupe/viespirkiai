import type { APIRoute } from 'astro';
import { getOpenGraphImage } from '@/utils/openGraphImage.js';

export const GET: APIRoute = async () => {
  const buffer = await getOpenGraphImage('Failai', 'Failų parsisiuntimo statistika', '', 'viespirkiai.org/failas');
  return new Response(new Uint8Array(buffer), {
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=7200, s-maxage=7200' },
  });
};
