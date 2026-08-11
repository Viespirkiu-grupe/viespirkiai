import type { APIRoute } from 'astro';
import { createCompressedSqliteStore } from '@/utils/sqliteSidecarStore.js';
import { isSidecarName } from '@/utils/sidecarPaths.js';

// Vienas read endpoint'as visiems sidecar'ams (`utils/sidecarPaths.js` registras):
//
//     GET /api/v1/sidecar/<vardas>?md5=<md5>
//
// Aptarnauja mazgą, kurio `SIDECAR_REMOTE` rodo čia. Skaitom TIK iš lokalaus
// SQLite — niekada per HTTP, kad du mazgai vienas kito neužciklintų
// (tas pats principas kaip utils/sidecarStore.js).
//
// Rašymo per HTTP nėra ir nebus: rašo tik tas mazgas, kuris turi `SIDECAR_DIR`.

const MD5 = /^[a-f0-9]{32}$/;

export const GET: APIRoute = async ({ params, url }) => {
    const name = params.name ?? '';
    if (!isSidecarName(name)) {
        return new Response('Nežinomas sidecar', { status: 404 });
    }

    const md5 = url.searchParams.get('md5');
    if (!md5 || !MD5.test(md5)) {
        return new Response('Blogas md5', { status: 400 });
    }

    const store = createCompressedSqliteStore({ sidecar: name });
    if (!store.configured()) {
        return new Response('SIDECAR_DIR nenustatytas', { status: 503 });
    }

    try {
        const content = await store.readRaw(md5);
        if (content === null) return new Response('Nerastas', { status: 404 });
        return new Response(content, {
            headers: { 'Content-Type': 'application/json' },
        });
    } catch (error) {
        console.error(`sidecar ${name} skaitymo klaida (md5=${md5}):`, error);
        return new Response('Nerastas', { status: 404 });
    }
};
