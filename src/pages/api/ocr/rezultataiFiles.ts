import type { APIRoute } from 'astro';
import { isOcrRezultataiLocalStoreConfigured, readRezultatasLocalRaw } from '@/modules/ocr/rezultataiFs.js';

export const GET: APIRoute = async ({ url }) => {
    const md5 = url.searchParams.get('md5');
    if (!md5 || !/^[a-f0-9]{32}$/.test(md5)) {
        return new Response('Blogas md5', { status: 400 });
    }
    if (!isOcrRezultataiLocalStoreConfigured()) {
        return new Response('OCR rezultatų saugykla nenustatyta', { status: 503 });
    }

    try {
        const content = await readRezultatasLocalRaw(md5);
        if (content === null) return new Response('Nerastas', { status: 404 });
        return new Response(content, {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch {
        return new Response('Nerastas', { status: 404 });
    }
};
