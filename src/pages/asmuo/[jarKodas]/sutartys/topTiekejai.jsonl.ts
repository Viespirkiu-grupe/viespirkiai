import type { APIRoute } from 'astro';
import { gautiSutarciuDuomenisPagalJarKoda } from '@/modules/sutartys/pagalJarKoda.js';
import { objectsToJsonlStream } from '@/utils/jsonl.js';

export const GET: APIRoute = async ({ params }) => {
  const { jarKodas } = params;
  if (!/^\d{1,9}$/.test(jarKodas!)) return new Response(null, { status: 404 });
  const sutartys = await gautiSutarciuDuomenisPagalJarKoda(jarKodas!);
  if (!sutartys) return new Response(null, { status: 404 });
  const stream = objectsToJsonlStream();
  stream.end(sutartys.topTiekejai ?? []);
  const { Readable } = await import('node:stream');
  const web = (Readable as any).toWeb(stream) as BodyInit;
  return new Response(web, {
    headers: {
      'Content-Type': 'application/jsonl; charset=utf-8',
      'Content-Disposition': `attachment; filename="top-tiekejai-${jarKodas}.jsonl"`,
    },
  });
};
