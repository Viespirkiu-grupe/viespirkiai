import type { APIRoute } from 'astro';
import { expandPirkimas } from '@/modules/rysiai/expand.js';
import { log } from '@/utils/log.js';

export const GET: APIRoute = async ({ params }) => {
  const { pirkimoId } = params;
  if (!pirkimoId || !/^\d+$/.test(pirkimoId))
    return Response.json({ error: 'Neteisingas pirkimoId' }, { status: 400 });
  try {
    return Response.json(await expandPirkimas(pirkimoId));
  } catch (err: any) {
    log(`expandPirkimas klaida (${pirkimoId}): ${err.message}`);
    return Response.json({ error: 'Vidinė klaida' }, { status: 500 });
  }
};
