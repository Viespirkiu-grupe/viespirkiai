import { postgres } from '@/postgres/postgres.js';
import { getOpenGraphImage } from '@/utils/openGraphImage.js';
import { CONTRACT_TYPES } from '@/modules/sutartys/contractTypes.js';

export async function GET({ params }: { params: { id: string } }) {
  const numId = parseInt(params.id);
  if (isNaN(numId)) return new Response(null, { status: 404 });

  const sutartis = await postgres
    .query('SELECT * FROM sutartys WHERE "sutartiesUnikalusId" = $1 LIMIT 1', [numId])
    .then((r: any) => r.rows[0]);

  if (!sutartis) return new Response(null, { status: 404 });

  const verte = Number(sutartis.faktineIvykdimoVerte || sutartis.verte)
    .toLocaleString('lt-LT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const tipo = (sutartis.tipas || '').trim().toUpperCase();
  const tipoPavadinimas = (CONTRACT_TYPES as Record<string, string>)[tipo] || tipo;

  const buffer = await getOpenGraphImage(
    tipoPavadinimas,
    `${verte} €   ${sutartis.pavadinimas}`,
    `Pirkėjas: ${sutartis.perkanciojiOrganizacija}<br>Tiekėjas: ${sutartis.tiekejas}`,
    `viespirkiai.org/sutartis/${sutartis.sutartiesUnikalusId}`,
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=7200, s-maxage=7200',
    },
  });
}
