import { getOpenGraphImage } from '@/utils/openGraphImage.js';

export async function GET() {
  const buffer = await getOpenGraphImage(
    'Viešai prieinami',
    'Duomenys',
    'Čia galite pasiekti mūsų duomenų eksportus bei sužinoti apie naudojamus šaltinius',
    'viespirkiai.org/duomenys',
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=7200, s-maxage=7200',
    },
  });
}
