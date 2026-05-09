import type { APIRoute } from 'astro';
import { expandSutartis } from '@/modules/rysiai/expand.js';
import { log } from '@/utils/log.js';

export const GET: APIRoute = async ({ params }) => {
  const { sutartiesUnikalusId } = params;
  if (!sutartiesUnikalusId || !/^\d+$/.test(sutartiesUnikalusId))
    return Response.json({ error: 'Neteisingas sutartiesUnikalusId' }, { status: 400 });
  try {
    return Response.json(await expandSutartis(sutartiesUnikalusId));
  } catch (err: any) {
    log(`expandSutartis klaida (${sutartiesUnikalusId}): ${err.message}`);
    return Response.json({ error: 'Vidinė klaida' }, { status: 500 });
  }
};
