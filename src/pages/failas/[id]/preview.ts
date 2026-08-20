import type { APIRoute } from 'astro';
import mime from 'mime';
import config from '../../../lib/config.ts';
import { checkFailasAccessible } from '@/modules/failai/queries.js';
import { gautiFaila } from '@/modules/failai/filesSkaitymas.js';

const handler: APIRoute = async ({ params, request }) => {
  const id = params.id;
  if (!id || isNaN(Number(id))) return new Response(null, { status: 404 });

  const failas = await gautiFaila(Number(id));
  if (!failas) return new Response(null, { status: 404 });

  const { error, message } = await checkFailasAccessible(failas);
  if (error) return new Response(message, { status: error });

  const needsConversion = !['pdf', 'prn'].includes(String(failas.extension).toLowerCase());
  const url = `${config.internalFileBase}/${failas.md5}${needsConversion ? '?convertTo=pdf' : ''}`;

  const isHead = request.method === 'HEAD';
  const range = request.headers.get('range');
  const upstreamHeaders = new Headers();
  if (range) upstreamHeaders.set('Range', range);

  const upstream = await fetch(url, {
    method: isHead ? 'HEAD' : 'GET',
    headers: upstreamHeaders,
  });

  // 416 Range Not Satisfiable turime persiųsti klientui, o ne versti į 500.
  if (upstream.status === 416) {
    const headers = new Headers({ 'Accept-Ranges': 'bytes' });
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) headers.set('Content-Range', contentRange);
    return new Response(null, { status: 416, headers });
  }

  if (!upstream.ok) return new Response('Nepavyko gauti failo.', { status: 500 });

  const contentType = upstream.headers.get('content-type') || mime.getType(failas.extension) || 'application/octet-stream';
  const filename = encodeURIComponent(failas.pavadinimas);

  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Disposition': `inline; filename*=UTF-8''${filename}`,
    'Cache-Control': 'private, max-age=86400, immutable',
  });

  // Ranged requests reikalingi video peržiūrai (seek), upstream juos palaiko.
  headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
  for (const header of ['content-length', 'content-range', 'etag', 'last-modified']) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  if (isHead) {
    upstream.body?.cancel();
    return new Response(null, { status: upstream.status, headers });
  }

  return new Response(upstream.body, { status: upstream.status, headers });
};

export const GET = handler;
export const HEAD = handler;
