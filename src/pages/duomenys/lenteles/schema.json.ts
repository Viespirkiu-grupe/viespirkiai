import type { APIRoute } from 'astro';
import { gautiSchemosModeli } from '@/src/lib/dbSchema/modelis.ts';

/** Visas schemos modelis JSON'u – mašinoms ir kūrėjams. */
export const GET: APIRoute = async () => {
  const modelis = await gautiSchemosModeli();

  const kunas = {
    sudaryta: modelis.sudaryta,
    metrikos: modelis.metrikos,
    schemos: modelis.schemos,
    rysiai: modelis.rysiai,
    lenteles: modelis.lenteles.map((l) => ({
      raktas: l.raktas,
      schema: l.schema,
      vardas: l.vardas,
      aprasymas: l.aprasymas,
      eiluciuIvertis: l.eiluciuIvertis,
      bendrasDydis: l.bendrasDydis,
      meta: l.meta,
      stulpeliai: l.stulpeliai,
      ribojimai: l.ribojimai,
      indeksai: l.indeksai.map((i) => ({ vardas: i.vardas, apibrezimas: i.apibrezimas })),
    })),
  };

  return new Response(JSON.stringify(kunas), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
