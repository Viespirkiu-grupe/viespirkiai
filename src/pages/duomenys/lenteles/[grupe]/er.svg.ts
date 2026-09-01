import type { APIRoute } from 'astro';
import { gautiSchemosModeli, grupesLenteles } from '@/src/lib/dbSchema/modelis.ts';
import { KOMPAKTINIO_RIBA, piestiSvg } from '@/src/lib/dbSchema/erDiagrama.ts';

/**
 * Grupės ER diagrama atskiru SVG – naršyklė tokį failą moka zoom'inti pati,
 * tad tai ir yra „pilno ekrano“ režimas bei dalinimosi nuoroda.
 *
 * Puslapyje spalvos ateina iš dizaino sistemos; atskirai atidarytas SVG jų
 * neturi, todėl čia įdedamas minimalus stilius su abiem temomis.
 */
const STILIUS = `
  <style>
    .er-box { fill: #fff; stroke: #b8b3ad; }
    .er-head { fill: #e7e5e4; }
    .er-title { font: 600 12px system-ui, sans-serif; fill: #1c1917; }
    .er-col { font: 11px monospace; fill: #57534e; }
    .er-edge { fill: none; stroke: #78716c; stroke-width: 1.2; }
    .er-arrow { fill: #78716c; }
    @media (prefers-color-scheme: dark) {
      .er-box { fill: #1c1917; stroke: #57534e; }
      .er-head { fill: #292524; }
      .er-title { fill: #fafaf9; }
      .er-col { fill: #a8a29e; }
      .er-edge { stroke: #a8a29e; }
      .er-arrow { fill: #a8a29e; }
    }
  </style>
`;

export const GET: APIRoute = async ({ params, url }) => {
  const modelis = await gautiSchemosModeli();
  const grupe = modelis.grupes.find((g) => g.raktas === params.grupe);

  if (!grupe) return new Response('Grupė nerasta', { status: 404 });

  const lenteles = grupesLenteles(modelis, grupe.raktas);
  const savos = new Set(lenteles.map((l) => l.raktas));
  const rysiai = modelis.rysiai.filter((r) => savos.has(r.is) && savos.has(r.i));

  const rezimas = url.searchParams.get('rezimas');
  const kompaktinis = rezimas === 'kompaktinis'
    || (rezimas !== 'pilnas' && lenteles.length > KOMPAKTINIO_RIBA);

  const { svg } = piestiSvg(lenteles, rysiai, { kompaktinis });
  if (!svg) return new Response('Grupė tuščia', { status: 404 });

  return new Response(svg.replace('<defs>', `${STILIUS}<defs>`), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
