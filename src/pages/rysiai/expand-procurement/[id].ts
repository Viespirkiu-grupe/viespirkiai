import type { APIRoute } from 'astro';
import { expandProcurement } from '@/modules/rysiai/expand.js';
import { log } from '@/utils/log.js';

export const GET: APIRoute = async ({ params }) => {
  const { id } = params;
  if (!id || !/^\d+$/.test(id))
    return Response.json({ error: 'Neteisingas pirkimoId' }, { status: 400 });
  try {
    return Response.json(await expandProcurement(id));
  } catch (err: any) {
    log(`expandProcurement klaida (${id}): ${err.message}`);
    return Response.json({ error: 'Vidinė klaida' }, { status: 500 });
  }
};
