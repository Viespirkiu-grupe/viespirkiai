import type { APIRoute } from 'astro';
import { isTedDbId, loadTedDbNotice, loadTedSampleXml } from '../../lib/ted.ts';

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id) {
    return new Response(null, { status: 404 });
  }

  if (isTedDbId(id)) {
    const notice = await loadTedDbNotice(id);
    if (!notice) {
      return new Response(null, { status: 404 });
    }

    return new Response(JSON.stringify(notice), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pavyzdiniai skelbimai aptarnaujami ir per HTML bei .xml – .json neturi būti išimtis.
  const sampleXml = loadTedSampleXml(id);
  if (!sampleXml) {
    return new Response(null, { status: 404 });
  }

  return new Response(JSON.stringify({ tedNoticeNumber: id, scrapeStatus: null, scrapeTimestamp: null, turinys: sampleXml }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
