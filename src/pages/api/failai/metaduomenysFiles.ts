import type { APIRoute } from 'astro';
import { getMetaduomenysPath } from '@/modules/failai/metaduomenysFs.js';
import fs from 'fs/promises';

export const GET: APIRoute = async ({ url }) => {
    const md5 = url.searchParams.get('md5');
    if (!md5 || !/^[a-f0-9]{32}$/.test(md5)) {
        return new Response('Blogas md5', { status: 400 });
    }

    const filePath = getMetaduomenysPath(md5);
    if (!filePath) {
        return new Response('failaiMetaduomenysLocation nenustatytas', { status: 503 });
    }

    try {
        const content = await fs.readFile(filePath, 'utf8');
        return new Response(content, {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch {
        return new Response('Nerastas', { status: 404 });
    }
};
