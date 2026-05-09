import type { APIRoute } from 'astro';
import { expandOrg } from '@/modules/rysiai/expand.js';
import { log } from '@/utils/log.js';

export const GET: APIRoute = async ({ params }) => {
  const { jarKodas } = params;
  if (!jarKodas || !/^\d+$/.test(jarKodas))
    return Response.json({ error: 'Neteisingas jarKodas' }, { status: 400 });
  try {
    return Response.json(await expandOrg(jarKodas));
  } catch (err: any) {
    log(`expandOrg klaida (${jarKodas}): ${err.message}`);
    return Response.json({ error: 'Vidinė klaida' }, { status: 500 });
  }
};
