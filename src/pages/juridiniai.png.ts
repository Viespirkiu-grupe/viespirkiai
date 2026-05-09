import type { APIRoute } from 'astro';
import { getOpenGraphImage } from '@/utils/openGraphImage.js';

export const GET: APIRoute = async () => {
  const buffer = await getOpenGraphImage('', 'Juridinių asmenų paieška', '', 'viespirkiai.org/juridiniai');
  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=7200, s-maxage=7200',
    },
  });
};
