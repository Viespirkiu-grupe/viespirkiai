import { getOpenGraphImage } from '@/utils/openGraphImage.js';

export async function GET() {
  const buffer = await getOpenGraphImage(
    '',
    'Privatumo politika',
    'Viešpirkiai puslapio privatumo politika',
    'viespirkiai.org/privatumas',
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=7200, s-maxage=7200',
    },
  });
}
