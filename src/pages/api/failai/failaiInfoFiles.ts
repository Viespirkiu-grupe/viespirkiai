import type { APIRoute } from 'astro';
import { isFailaiLocalStoreConfigured, readFailaiLocalRaw } from '@/modules/failai/failaiFs.js';

// Atiduoda sujungtą failo turinio JSON iš lokalaus SQLite kitam mazgui, kai to
// mazgo FAILAI_LOCATION yra šio endpoint'o HTTP(S) URL.
// Raktas — turinio hash'as (`?hash=`), ne failo md5: žr. modules/failai/failaiFs.js.
export const GET: APIRoute = async ({ url }) => {
    const hash = url.searchParams.get('hash');
    if (!hash || !/^[a-f0-9]{32}$/.test(hash)) {
        return new Response('Blogas hash', { status: 400 });
    }
    if (!isFailaiLocalStoreConfigured()) {
        return new Response('Failų saugykla nenustatyta', { status: 503 });
    }

    try {
        const content = await readFailaiLocalRaw(hash);
        if (content === null) return new Response('Nerastas', { status: 404 });
        return new Response(content, {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch {
        return new Response('Nerastas', { status: 404 });
    }
};
