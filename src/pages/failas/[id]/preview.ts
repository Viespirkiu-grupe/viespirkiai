import type { APIRoute } from 'astro';
import mime from 'mime';
import config from '../../../lib/config.ts';
import { postgres } from '@/postgres/postgres.js';
import { checkFailasAccessible } from '@/modules/failai/queries.js';

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id || isNaN(Number(id))) return new Response(null, { status: 404 });

  const result = await postgres.query(`SELECT * FROM failai WHERE "id" = $1 LIMIT 1`, [id]);
  if (!result.rows.length) return new Response(null, { status: 404 });
  const failas = result.rows[0];

  const { error, message } = await checkFailasAccessible(failas);
  if (error) return new Response(message, { status: error });

  const needsConversion = !['pdf', 'prn'].includes(String(failas.extension).toLowerCase());
  const url = `${config.internalFileBase}/${failas.md5}${needsConversion ? '?convertTo=pdf' : ''}`;

  const upstream = await fetch(url);
  if (!upstream.ok) return new Response('Nepavyko gauti failo.', { status: 500 });

  const contentType = upstream.headers.get('content-type') || mime.getType(failas.extension) || 'application/octet-stream';
  const filename = encodeURIComponent(failas.pavadinimas);

  return new Response(upstream.body, {
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename*=UTF-8''${filename}`,
      'Cache-Control': 'private, max-age=86400, immutable',
    },
  });
};
