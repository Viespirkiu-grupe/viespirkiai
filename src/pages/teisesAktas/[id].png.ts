import { postgres } from '@/postgres/postgres.js';
import { getOpenGraphImage } from '@/utils/openGraphImage.js';
import { statusasLabel } from '../../lib/teisesAktaiLabels.ts';

export async function GET({ params, url }: { params: { id: string }, url: URL }) {
  const legalActId = params.id ?? '';
  if (!legalActId) return new Response(null, { status: 404 });

  const wanted = url.searchParams.get('v') ?? '';

  const actRes = await postgres.query(
    `SELECT a."title" FROM "eTar"."legalAct" a WHERE a."legalActId" = $1`,
    [legalActId],
  );
  const act = actRes.rows[0];
  if (!act) return new Response(null, { status: 404 });

  const docRes = await postgres.query(
    `SELECT d."title", d."documentId", d."editionToken", v."code" AS "variantas"
       FROM "eTar"."legalActDocument" d
       JOIN "eTar"."documentVariant" v USING ("documentVariantId")
      WHERE d."legalActId" = $1
      ORDER BY (v."code" = 'original') DESC, d."documentId"`,
    [legalActId],
  );
  // Ta pati pasirinkimo logika kaip loadTeisesAktasPage: `?v=` žymi arba
  // redakcijos tokeną, arba varianto kodą; kitu atveju — originalas.
  const documents = docRes.rows as Array<{ title: string; documentId: number; editionToken: string | null; variantas: string }>;
  const doc = documents.find(d => d.editionToken === wanted)
    ?? documents.find(d => d.variantas === wanted)
    ?? documents.find(d => d.variantas === 'original')
    ?? documents[0];

  let statusas: string | null = null;
  let adoptedBy: string | null = null;
  if (doc) {
    const [metaRes, fieldRes] = await Promise.all([
      postgres.query(
        `SELECT s."name" AS "statusas"
           FROM "eTar"."documentMetadata" m
           LEFT JOIN "eTar"."actStatus" s USING ("actStatusId")
          WHERE m."documentId" = $1`,
        [doc.documentId],
      ),
      postgres.query(
        `SELECT k."code", f."valueText"
           FROM "eTar"."metadataField" f
           JOIN "eTar"."metadataFieldKey" k USING ("metadataFieldKeyId")
           JOIN "eTar"."documentMetadata" m ON m."metadataId" = f."metadataId"
          WHERE m."documentId" = $1 AND k."code" IN ('act_type', 'adopted_by')
          ORDER BY k."metadataFieldKeyId"`,
        [doc.documentId],
      ),
    ]);
    statusas = metaRes.rows[0]?.statusas ?? null;
    const fieldByCode = new Map(fieldRes.rows.map((r: any) => [r.code, r.valueText]));
    adoptedBy = fieldByCode.get('adopted_by') ?? null;
  }

  const title = doc?.title || act.title;
  const aprasymas = [statusas ? statusasLabel(statusas) : null, adoptedBy]
    .filter(Boolean)
    .join(' · ');

  const buffer = await getOpenGraphImage(
    'Teisės aktas',
    title,
    aprasymas,
    `viespirkiai.org/teisesAktas/${legalActId}`,
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=7200, s-maxage=7200',
    },
  });
}
