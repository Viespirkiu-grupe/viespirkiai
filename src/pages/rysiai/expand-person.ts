import type { APIRoute } from 'astro';
import { expandPerson } from '@/modules/rysiai/expand.js';
import { log } from '@/utils/log.js';

export const GET: APIRoute = async ({ url }) => {
  const vardas = url.searchParams.get('vardas')?.trim();
  if (!vardas)
    return Response.json({ error: 'Trūksta parametro: vardas' }, { status: 400 });
  try {
    return Response.json(await expandPerson(vardas));
  } catch (err: any) {
    log(`expandPerson klaida (${vardas}): ${err.message}`);
    return Response.json({ error: 'Vidinė klaida' }, { status: 500 });
  }
};
