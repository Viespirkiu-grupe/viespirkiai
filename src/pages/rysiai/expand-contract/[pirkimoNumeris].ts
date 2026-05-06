import type { APIRoute } from 'astro';
import { expandContract } from '@/modules/rysiai/expand.js';
import { log } from '@/utils/log.js';

export const GET: APIRoute = async ({ params }) => {
  const { pirkimoNumeris } = params;
  if (!pirkimoNumeris || !/^\d+$/.test(pirkimoNumeris))
    return Response.json({ error: 'Neteisingas pirkimoNumeris' }, { status: 400 });
  try {
    return Response.json(await expandContract(pirkimoNumeris));
  } catch (err: any) {
    log(`expandContract klaida (${pirkimoNumeris}): ${err.message}`);
    return Response.json({ error: 'Vidinė klaida' }, { status: 500 });
  }
};
