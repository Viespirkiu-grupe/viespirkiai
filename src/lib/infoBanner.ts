/**
 * Informacinio banerio (viršuje) šaltinis — DB lentelė `public."infoBaneris"`.
 *
 * Anksčiau baneris buvo imamas iš `config.infoBanner`. Dabar jį valdo DB lentelė
 * su laukais `enabled` ir `aplinka` (kur rodyti). Reikšmė cache'inama procese ir
 * atnaujinama per pg_notify (trigger `info_baneris`), su 1 min. poll'u kaip
 * atsargine priemone. Header.astro tik nuskaito jau paruoštą cache'ą.
 */
import { postgres } from '@/postgres/postgres.js';
import { subscribe } from '@/postgres/pgNotifyHub.js';
import config from '@/utils/config.js';
import type { InfoBanner } from './config.ts';

const NOTIFY_CHANNEL = 'info_baneris';
const POLL_INTERVAL_MS = 60_000;

/**
 * Aplinka, kurioje sukasi šis procesas – nustatoma pagal `config.dev`.
 * Lentelės stulpelyje `aplinka`: NULL = visur; 'dev' = tik dev; 'prod' = tik gyvoje.
 */
const currentEnv: 'dev' | 'prod' = config.dev ? 'dev' : 'prod';

let cached: InfoBanner | null = null;
let initPromise: Promise<void> | null = null;

async function ensureTable(): Promise<void> {
  const client = await postgres.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public."infoBaneris" (
        id          serial PRIMARY KEY,
        content     text        NOT NULL,
        type        text        NOT NULL DEFAULT 'text'  CHECK (type IN ('text', 'html')),
        important   boolean     NOT NULL DEFAULT false,
        enabled     boolean     NOT NULL DEFAULT false,
        aplinka     text                                  CHECK (aplinka IN ('dev', 'prod')),
        atnaujinta  timestamptz NOT NULL DEFAULT now()
      )
    `);

    await client.query(`
      COMMENT ON COLUMN public."infoBaneris".aplinka IS
        'Kur rodyti: NULL = visur; ''dev'' = tik dev aplinkoje; ''prod'' = tik gyvoje. Aplinka nustatoma pagal config.dev.'
    `);

    // Trigger'is: bet koks pakeitimas -> pg_notify, kad procesai perkrautų cache'ą.
    await client.query(`
      CREATE OR REPLACE FUNCTION public."infoBaneris_notify"() RETURNS trigger AS $$
      BEGIN
        PERFORM pg_notify('${NOTIFY_CHANNEL}', '');
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`DROP TRIGGER IF EXISTS "infoBaneris_notify" ON public."infoBaneris"`);
    await client.query(`
      CREATE TRIGGER "infoBaneris_notify"
      AFTER INSERT OR UPDATE OR DELETE ON public."infoBaneris"
      FOR EACH STATEMENT EXECUTE FUNCTION public."infoBaneris_notify"()
    `);
  } finally {
    client.release();
  }
}

async function reload(): Promise<void> {
  try {
    const { rows } = await postgres.query(
      `SELECT type, content, important
         FROM public."infoBaneris"
        WHERE enabled = true
          AND (aplinka IS NULL OR aplinka = $1)
        ORDER BY important DESC, atnaujinta DESC
        LIMIT 1`,
      [currentEnv],
    );
    const row = rows[0];
    const content = typeof row?.content === 'string' ? row.content.trim() : '';
    cached = content
      ? {
          type: row.type === 'html' ? 'html' : 'text',
          content,
          important: row.important === true,
        }
      : null;
  } catch {
    // Klaidos atveju paliekam paskutinę žinomą reikšmę – banerio dingimas nekritinis.
  }
}

async function init(): Promise<void> {
  await ensureTable();
  await reload();
  subscribe(NOTIFY_CHANNEL, () => {
    void reload();
  });
  setInterval(() => {
    void reload();
  }, POLL_INTERVAL_MS).unref?.();
}

/**
 * Grąžina šiuo metu rodytiną banerį (arba null). Pirmas kvietimas inicijuoja
 * lentelę, užkrauna cache'ą ir prisijungia prie pg_notify; toliau – akimirksniu iš cache.
 */
export async function getInfoBanner(): Promise<InfoBanner | null> {
  if (!initPromise) {
    initPromise = init().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  try {
    await initPromise;
  } catch {
    return null;
  }
  return cached;
}
