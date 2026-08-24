import type { APIRoute } from 'astro';
import { gautiSchemosModeli, rasti } from '@/src/lib/dbSchema/modelis.ts';
import { lentelesUrl } from '@/src/lib/dbSchema/grupes.ts';

/**
 * Nuoroda į lentelę žinant tik jos vardą, be grupės.
 * Patogu linkinti iš MCP, /statistika ar išorės – grupę parenka pats puslapis.
 */
export const GET: APIRoute = async ({ params, redirect }) => {
  const modelis = await gautiSchemosModeli();
  const lentele = rasti(modelis, params.lentele ?? '');

  if (!lentele) return redirect('/duomenys/lenteles', 302);

  return redirect(lentelesUrl(lentele.grupe.raktas, lentele.schema, lentele.vardas), 302);
};
