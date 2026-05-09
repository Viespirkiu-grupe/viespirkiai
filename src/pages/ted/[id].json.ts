import type { APIRoute } from 'astro';
import { isTedDbId, loadTedDbNotice } from '../../lib/ted.ts';

export const GET: APIRoute = async ({ params }) => {
  const id = params.id;
  if (!id || !isTedDbId(id)) {
    return new Response(null, { status: 404 });
  }

  const notice = await loadTedDbNotice(id);
  if (!notice) {
    return new Response(null, { status: 404 });
  }

  return new Response(JSON.stringify(notice), {
    headers: { 'Content-Type': 'application/json' },
  });
};
