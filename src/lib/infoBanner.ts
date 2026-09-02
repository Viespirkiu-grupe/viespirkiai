/**
 * Informacinio banerio (viršuje) šaltinis — DB lentelė `viespirkiai."infoBaneris"`.
 *
 * Anksčiau baneris buvo imamas iš `config.infoBanner`. Dabar jį valdo DB lentelė
 * su laukais `enabled` ir `aplinka` (kur rodyti). Reikšmė cache'inama procese;
 * atnaujinama poll'u, o `npm run baneris:reload` NATS signalu perkrauna iškart
 * (lentelė redaguojama ranka per SQL, tad DB pusėje siuntėjo nėra).
 * Header.astro tik nuskaito jau paruoštą cache'ą.
 */
import { postgres } from '@/postgres/postgres.js';
import { subscribe } from '@/utils/natsHub.js';
import config from '@/utils/config.js';
import type { InfoBanner } from './config.ts';

/** NATS kanalas: banerio cache'ą reikia perkrauti. */
export const BANERIS_CHANNEL = 'info_baneris';
const POLL_INTERVAL_MS = 20_000;

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
      CREATE TABLE IF NOT EXISTS viespirkiai."infoBaneris" (
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
      COMMENT ON COLUMN viespirkiai."infoBaneris".aplinka IS
        'Kur rodyti: NULL = visur; ''dev'' = tik dev aplinkoje; ''prod'' = tik gyvoje. Aplinka nustatoma pagal config.dev.'
    `);

  } finally {
    client.release();
  }
}

async function reload(): Promise<void> {
  const { rows } = await postgres.query(
      `SELECT type, content, important
         FROM viespirkiai."infoBaneris"
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
}

/** Perkrovimas fone – klaidos ignoruojamos, paliekama paskutinė žinoma reikšmė. */
async function reloadTyliai(): Promise<void> {
  try {
    await reload();
  } catch {
    // Banerio dingimas nekritinis.
  }
}

async function init(): Promise<void> {
  try {
    await reload();
  } catch (err: any) {
    // 42P01 = undefined_table. Schema laikoma `dbSchema/`, tad įprastai lentelė
    // jau yra ir jokio DDL paleidžiant nereikia; kuriam ją tik tada, kai tai
    // tuščia/nauja DB (anksčiau CREATE TABLE/FUNCTION/TRIGGER sukdavosi per
    // kiekvieną startą).
    if (err?.code !== '42P01') throw err;
    await ensureTable();
    await reload();
  }
  subscribe(BANERIS_CHANNEL, () => {
    void reloadTyliai();
  });
  setInterval(() => {
    void reloadTyliai();
  }, POLL_INTERVAL_MS).unref?.();
}

/**
 * Grąžina šiuo metu rodytiną banerį (arba null). Pirmas kvietimas inicijuoja
 * lentelę, užkrauna cache'ą ir prisijungia prie NATS; toliau – akimirksniu iš cache.
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
