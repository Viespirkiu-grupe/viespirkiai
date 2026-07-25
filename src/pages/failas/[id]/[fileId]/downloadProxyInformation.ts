import type { APIRoute } from 'astro';
import { validateReverseProxyApiKey } from '@/modules/failai/auth.js';
import { findFailas, getDezeForMd5, checkFailasAccessible } from '@/modules/failai/queries.js';
import { gautiFaila } from '@/modules/failai/filesSkaitymas.js';
import { buildProxyResponse } from '@/modules/failai/proxy.js';

export const GET: APIRoute = async ({ params, request }) => {
  const { error, message } = await validateReverseProxyApiKey(request.headers.get('authorization'));
  if (error) return new Response(message, { status: error });

  const result = await findFailas({ id: undefined, dokId: params.id, fileId: params.fileId } as any);
  if (!result?.rows.length) return new Response(null, { status: 404 });
  const failas = result.rows[0];

  const { error: accessError, message: accessMessage } = await checkFailasAccessible(failas);
  if (accessError) return new Response(accessMessage, { status: accessError });

  if (failas.parent || failas.parsiustas === -5) {
    const parent = await gautiFaila(failas.parent);
    if (!parent) return new Response('Tėvinis failas nerastas.', { status: 404 });

    const deze = await getDezeForMd5(parent.md5);
    if (!deze) return new Response('Dėžė nerasta.', { status: 404 });

    return Response.json(buildProxyResponse(failas, deze, parent));
  }

  const deze = await getDezeForMd5(failas.md5);
  if (!deze) return new Response('Dėžė nerasta.', { status: 404 });

  return Response.json(buildProxyResponse(failas, deze));
};
