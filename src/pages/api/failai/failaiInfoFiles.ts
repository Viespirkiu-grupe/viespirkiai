import type { APIRoute } from 'astro';
import { getFailaiPath } from '@/modules/failai/failaiFs.js';
import fs from 'fs/promises';

// Atiduoda sujungtą failo turinio JSON (FAILAI_LOCATION) kitam mazgui, kai tas
// mazgas neturi lokalaus disko ir jo FAILAI_LOCATION yra šio endpoint'o URL.
// Raktas — turinio hash'as (`?hash=`), ne failo md5: žr. modules/failai/failaiFs.js.
export const GET: APIRoute = async ({ url }) => {
    const hash = url.searchParams.get('hash');
    if (!hash || !/^[a-f0-9]{32}$/.test(hash)) {
        return new Response('Blogas hash', { status: 400 });
    }

    const filePath = getFailaiPath(hash);
    if (!filePath) {
        return new Response('failaiLocation nenustatytas', { status: 503 });
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
