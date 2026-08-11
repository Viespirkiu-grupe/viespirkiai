import type { APIRoute } from 'astro';
import { createCompressedSqliteStore } from '@/utils/sqliteSidecarStore.js';
import { isSidecarName, SIDECAR_BATCH_LIMIT } from '@/utils/sidecarPaths.js';

// Masinis to paties registro skaitymas:
//
//     POST /api/v1/sidecar/<vardas>/batch
//     body: ["<md5>", …]  arba  md5 per eilutę
//     200:  application/x-ndjson, po eilutę {"md5":…,"turinys":…}
//
// Kodėl JSONL, o ne vienas JSON: 500 dokumentų gali būti dešimtys MB, tad
// atsakymą streaminam gabalais ir klientas gali apdoroti eilutę po eilutės
// nelaukdamas pabaigos. Grąžinam TIK rastus raktus — ko negrįžo, to nėra;
// taip atsakymas lieka mažas, kai didžioji dalis raktų nerandama.
//
// Rašymo per HTTP nėra (žr. ../[name].ts).

const MD5 = /^[a-f0-9]{32}$/;

// Kiek raktų imam iš SQLite vienu kartu. Visa partija vienu query būtų greičiau,
// bet tada dešimtys MB dekompresuoto teksto vienu metu gulėtų atmintyje.
const CHUNK = 50;

/** Body gali būti JSON masyvas arba md5 per eilutę — abu formatai patogūs curl'ui. */
function parseKeys(body: string): string[] | null {
    const trimmed = body.trim();
    if (!trimmed) return [];
    if (trimmed.startsWith('[')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (!Array.isArray(parsed)) return null;
            return parsed.map(String);
        } catch {
            return null;
        }
    }
    return trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
}

export const POST: APIRoute = async ({ params, request }) => {
    const name = params.name ?? '';
    if (!isSidecarName(name)) {
        return new Response('Nežinomas sidecar', { status: 404 });
    }

    const keys = parseKeys(await request.text());
    if (keys === null) {
        return new Response('Blogas body: laukiamas JSON masyvas arba md5 per eilutę', {
            status: 400,
        });
    }
    if (keys.length > SIDECAR_BATCH_LIMIT) {
        return new Response(
            `Per daug raktų: ${keys.length}, leidžiama ${SIDECAR_BATCH_LIMIT}`,
            { status: 400 },
        );
    }
    const blogas = keys.find((key) => !MD5.test(key));
    if (blogas !== undefined) {
        return new Response(`Blogas md5: ${blogas}`, { status: 400 });
    }

    const store = createCompressedSqliteStore({ sidecar: name });
    if (!store.configured()) {
        return new Response('SIDECAR_DIR nenustatytas', { status: 503 });
    }

    // Dublikatai užklausoje neturi virsti dublikatais atsakyme.
    const unikalus = [...new Set(keys)];

    const stream = new ReadableStream({
        async pull(controller) {
            // Vienas `pull` = vienas gabalas; kai raktai baigiasi, uždarom srautą.
            const chunk = unikalus.splice(0, CHUNK);
            if (!chunk.length) {
                controller.close();
                return;
            }
            try {
                const found = await store.readManyRaw(chunk);
                let out = '';
                for (const [md5, turinys] of found) {
                    out += `${JSON.stringify({ md5, turinys })}\n`;
                }
                if (out) controller.enqueue(new TextEncoder().encode(out));
            } catch (error) {
                console.error(`sidecar ${name} batch skaitymo klaida:`, error);
                controller.error(error);
            }
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-store',
        },
    });
};
