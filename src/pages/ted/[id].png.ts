import { getOpenGraphImage } from '@/utils/openGraphImage.js';
import { loadTedNoticePageData } from '../../lib/ted.ts';

export async function GET({ params }: { params: { id: string } }) {
  const id = params.id;
  if (!id) return new Response(null, { status: 404 });

  const noticeData = await loadTedNoticePageData(id);
  if (!noticeData) return new Response(null, { status: 404 });

  const { view } = noticeData;
  const verte = view.procScope?.value?.values?.[0];
  const pavadinimas = [verte ? `${verte}  ` : '', view.pageTitle].join('');
  const aprasymas = [
    view.primaryOrg?.label ? `Pirkėjas: ${view.primaryOrg.label}` : null,
    [view.subTypeDescription, view.issueDateText && `Išleista ${view.issueDateText}`].filter(Boolean).join(' · '),
  ].filter(Boolean).join('<br>');

  const buffer = await getOpenGraphImage(
    view.documentTypeLabel,
    pavadinimas,
    aprasymas,
    `viespirkiai.org/ted/${id}`,
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=7200, s-maxage=7200',
    },
  });
}
