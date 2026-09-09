import type { APIRoute } from 'astro';
import { gautiSchemosModeli, rasti } from '@/src/lib/dbSchema/modelis.ts';
import { lentelesUrl } from '@/src/lib/dbSchema/schemos.ts';

/**
 * Nuoroda į lentelę žinant tik jos vardą, be schemos.
 * Patogu linkinti iš MCP, /statistika ar išorės – schemą parenka pats puslapis.
 * Kai vardas kartojasi keliose schemose, `rasti` nespėlioja ir vedam į sąrašą.
 */
export const GET: APIRoute = async ({ params, redirect }) => {
  const modelis = await gautiSchemosModeli();
  const lentele = rasti(modelis, params.lentele ?? '');

  if (!lentele) return redirect('/duomenys/lenteles', 302);

  return redirect(lentelesUrl(lentele.schema, lentele.vardas), 302);
};
