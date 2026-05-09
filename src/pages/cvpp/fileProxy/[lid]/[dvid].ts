import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params, request }) => {
  const { lid, dvid } = params;
  const url = `https://pirkimai.eviesiejipirkimai.lt/app/docmgmt/downloadPublicDocument.asp?FMT=5&AT=3&LID=${lid}&DVID=${dvid}`;

  const ac = new AbortController();
  const { signal } = ac;
  request.signal.addEventListener('abort', () => ac.abort());

  try {
    const cookieRes = await fetch(url, { redirect: 'manual', signal });
    const cookies =
      cookieRes.headers.getSetCookie?.() ??
      (cookieRes.headers.get('set-cookie') ? [cookieRes.headers.get('set-cookie')!] : []);
    const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');

    const fileRes = await fetch(url, {
      headers: cookieHeader ? { cookie: cookieHeader } : undefined,
      signal,
    });

    if (!fileRes.ok) return new Response('Nepavyko gauti failo.', { status: fileRes.status });

    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
    const contentDisposition = fileRes.headers.get('content-disposition') || `attachment; filename="${dvid}_${lid}"`;

    return new Response(fileRes.body, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': contentDisposition,
        'Cache-Control': 'private, max-age=86400, immutable',
      },
    });
  } catch (err: any) {
    if (err.name === 'AbortError') return new Response(null, { status: 499 });
    console.error('Proxy error:', err);
    return new Response('Proxy error.', { status: 502 });
  }
};
