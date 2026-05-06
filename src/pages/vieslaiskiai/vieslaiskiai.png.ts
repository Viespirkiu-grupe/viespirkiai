import { getOpenGraphImage } from '@/utils/openGraphImage.js';

export async function GET() {
  const buffer = await getOpenGraphImage(
    'Viešlaiškiai',
    'Viešpirkių iniciatyvos viešlaiškiai',
    '',
    'viespirkiai.org/vieslaiskiai',
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=7200, s-maxage=7200',
    },
  });
}
