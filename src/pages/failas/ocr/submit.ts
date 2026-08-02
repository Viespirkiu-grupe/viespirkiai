import type { APIRoute } from 'astro';
import { validateOcrApiKey } from '@/modules/failai/auth.js';
import { postgres } from '@/postgres/postgres.js';
import { saveRezultatasFs } from '@/modules/ocr/rezultataiFs.js';
import { iEile } from '@/modules/failai/nuskaitymoEile.js';
import { pazymetiOcrRezultata } from '@/modules/failai/ocrEile.js';
import { atstatytiNuskaityma } from '@/modules/failai/nuskaitymoRezultatas.js';

export const GET: APIRoute = async () => {
  return new Response('Method not allowed', { status: 405 });
};

function extractApiKey(request: Request): string | null {
  const url = new URL(request.url);
  const fromQuery = url.searchParams.get('apiKey');
  if (fromQuery) return fromQuery;
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  const apiKey = extractApiKey(request);
  const { user, error, message } = await validateOcrApiKey(apiKey);
  if (error) return new Response(message, { status: error });

  const body = await request.json().catch(() => null);
  const { id, tekstas, duration } = body ?? {};

  if (
    typeof id !== 'number' ||
    typeof duration !== 'number' ||
    !Array.isArray(tekstas) ||
    !tekstas.every((t: unknown) => typeof t === 'string')
  ) {
    return new Response('Neteisingi arba trūkstami parametrai: id, tekstas, duration.', { status: 400 });
  }

  const client = await postgres.connect();
  try {
    await client.query('BEGIN');

    // Rezervacija ir yra autorizacija: eilutė paimama tik jei ją laiko būtent šis node'as.
    const queueRes = await client.query(
      `DELETE FROM public."filesOcrQueue" q
       USING public.files f
       LEFT JOIN public."filesMd5" m ON m.id = f."md5Id"
       WHERE q.id = $1 AND q."lockedBy" = $2 AND f.id = q.id
       RETURNING q."lockedAt", m.md5`,
      [id, user.pavadinimas],
    );
    if (!queueRes.rows.length) {
      await client.query('ROLLBACK');
      return new Response('Failas nerastas arba neužrakintas šiam vartotojui.', { status: 404 });
    }

    const { lockedAt, md5 } = queueRes.rows[0];
    const puslapiuSkaicius = tekstas.length;
    const zodziuSkaicius = tekstas.reduce(
      (sum: number, page: string) => sum + page.split(/\s+/).filter(Boolean).length,
      0,
    );

    // Vienas pg klientas gali vykdyti tik po vieną užklausą – tranzakcijoje jos
    // vis tiek serializuojamos, todėl vykdom nuosekliai (Promise.all sukeltų
    // "client is already executing a query" perspėjimą).
    await pazymetiOcrRezultata(
      { id, nodeId: user.id, md5, duration, pageCount: puslapiuSkaicius, wordCount: zodziuSkaicius },
      client,
    );

    // Po OCR failą reikia nuskaityti iš naujo — versija nulinama, tik tada eilė jį priims.
    await atstatytiNuskaityma([id], client);
    await iEile([id], client);

    await client.query(
      `UPDATE "ocrNuskaitytojai" SET "nuskaitytiDokumentai" = "nuskaitytiDokumentai" + 1 WHERE id = $1`,
      [user.id],
    );
    await client.query(
      `SELECT pg_notify('ocr_latest_results', json_build_object('failas', $1::int, 'node', $2::text)::text)`,
      [id, user.pavadinimas],
    );

    // Blob'as turi būti patvariai įrašytas prieš paskelbiant jo resultHash.
    // Jei SQLite/FS write nepavyksta, PG tranzakcija grąžinama ir darbas gali
    // būti pakartotas; priešingu atveju DB rodytų į neegzistuojantį rezultatą.
    await saveRezultatasFs({ failas: id, md5, tekstas, node: user.pavadinimas, submitTimestamp: new Date().toISOString(), lockTimestamp: lockedAt, duration, puslapiuSkaicius, zodziuSkaicius });

    await client.query('COMMIT');

    return Response.json({ status: 'ok' });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};
