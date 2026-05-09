import type { APIRoute } from 'astro';
import { validateOcrApiKey } from '@/modules/failai/auth.js';
import { postgres } from '@/postgres/postgres.js';

export const GET: APIRoute = async ({ request }) => {
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

    const queueRes = await client.query(
      `DELETE FROM public."failaiOcrQueue"
      WHERE id = $1 AND "lockedBy" = $2
       RETURNING "lockedAt"`,
      [id, user.pavadinimas],
    );
    if (!queueRes.rows.length) {
      await client.query('ROLLBACK');
      return new Response('Failas nerastas arba neužrakintas šiam vartotojui.', { status: 404 });
    }

    const { lockedAt } = queueRes.rows[0];
    const puslapiuSkaicius = tekstas.length;
    const zodziuSkaicius = tekstas.reduce(
      (sum: number, page: string) => sum + page.split(/\s+/).filter(Boolean).length,
      0,
    );

    await Promise.all([
      client.query(
        `UPDATE failai SET "ocrState" = 1, "nuskaitytas" = 0, "ocrLockTimestamp" = NULL WHERE id = $1`,
        [id],
      ),
      client.query(
        `INSERT INTO "failaiOcrRezultatai" (failas, tekstas, node, "submitTimestamp", "lockTimestamp", duration, "puslapiuSkaicius", "zodziuSkaicius")
         VALUES ($1, $2, $3, NOW(), $4, $5, $6, $7)`,
        [id, tekstas, user.pavadinimas, lockedAt, duration, puslapiuSkaicius, zodziuSkaicius],
      ),
      client.query(
        `UPDATE "ocrNuskaitytojai" SET "nuskaitytiDokumentai" = "nuskaitytiDokumentai" + 1 WHERE id = $1`,
        [user.id],
      ),
    ]);

    await client.query('COMMIT');
    return Response.json({ status: 'ok' });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};
