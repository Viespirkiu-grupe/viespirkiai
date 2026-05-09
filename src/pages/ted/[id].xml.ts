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

    return new Response(notice.turinys, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
    });
  }

  const sampleXml = loadTedSampleXml(id);
  if (!sampleXml) {
    return new Response(null, { status: 404 });
  }

  return new Response(sampleXml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
