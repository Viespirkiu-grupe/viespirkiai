import type { APIRoute } from 'astro';
import { gautiSutarciuDuomenisPagalJarKoda } from '@/modules/sutartys/pagalJarKoda.js';
import { objectsToCSV } from '@/utils/csv.js';

export const GET: APIRoute = async ({ params }) => {
  const { jarKodas } = params;
  if (!/^\d{1,9}$/.test(jarKodas!)) return new Response(null, { status: 404 });
  const sutartys = await gautiSutarciuDuomenisPagalJarKoda(jarKodas!);
  if (!sutartys) return new Response(null, { status: 404 });
  const stream = objectsToCSV(sutartys.topPirkejai ?? []);
  const { Readable } = await import('node:stream');
  const web = (Readable as any).toWeb(stream) as BodyInit;
  return new Response(web, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="top-pirkejai-${jarKodas}.csv"`,
    },
  });
};
