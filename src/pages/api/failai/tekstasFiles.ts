import type { APIRoute } from 'astro';
import { getTekstasPath } from '@/modules/failai/tekstasFs.js';
import fs from 'fs/promises';

export const GET: APIRoute = async ({ url }) => {
    const md5 = url.searchParams.get('md5');
    if (!md5 || !/^[a-f0-9]{32}$/.test(md5)) {
        return new Response('Blogas md5', { status: 400 });
    }

    const filePath = getTekstasPath(md5);
    if (!filePath) {
        return new Response('failaiTekstasLocation nenustatytas', { status: 503 });
    }

    try {
        const content = await fs.readFile(filePath, 'utf8');
        return new Response(content, {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    } catch {
        return new Response('Nerastas', { status: 404 });
    }
};
