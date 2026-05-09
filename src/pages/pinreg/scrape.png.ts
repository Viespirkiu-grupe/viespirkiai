import { getOpenGraphImage } from '@/utils/openGraphImage.js';

export async function GET() {
  const buffer = await getOpenGraphImage(
    'Viešpirkiai pilietinė iniciatyva',
    'Privačių interesų registro duomenų atnaujinimo puslapis',
    '',
    'viespirkiai.org/pinreg/scrape',
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=7200, s-maxage=7200',
    },
  });
}
