import type { APIRoute } from 'astro';
import { validateOcrApiKey } from '@/modules/failai/auth.js';
import { checkoutNextFile, buildFileUri } from '@/modules/failai/ocr.js';

function extractApiKey(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('apiKey');
  if (fromQuery) return fromQuery;
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

const handleCheckout: APIRoute = async ({ request }) => {
  const apiKey = extractApiKey(request);
  const { user, error, message } = await validateOcrApiKey(apiKey);
  if (error) return new Response(message, { status: error });

  const failas = await checkoutNextFile(user);
  if (!failas) return new Response('Nėra OCR laukiančių failų.', { status: 404 });

  return Response.json({
    id: failas.id,
    uri: buildFileUri(failas),
    expires: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
    extension: failas.extension,
  });
};

export const GET = handleCheckout;
export const POST = handleCheckout;
