import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import config from '@/utils/config.js';
import { createSidecarStore } from '@/utils/sidecarStore.js';
import { closeCompressedSqliteStores } from '@/utils/sqliteSidecarStore.js';
import { SIDECAR_BATCH_LIMIT } from '@/utils/sidecarPaths.js';
import { GET } from '@/src/pages/api/v1/sidecar/[name].ts';
import { POST } from '@/src/pages/api/v1/sidecar/[name]/batch.ts';

const store = createSidecarStore({ sidecar: 'dokumentai', label: 'testo' });
const md5 = (i: number) => i.toString(16).padStart(32, '0');

let tempDir: string;
let originalSidecarDir: string | undefined;

/** Route'ams reikia tik `params` ir `url`/`request` — likusio konteksto neliečia. */
function get(name: string, query: string) {
  return GET({
    params: { name },
    url: new URL(`http://test/api/v1/sidecar/${name}?${query}`),
  } as any);
}

function post(name: string, body: string) {
  return POST({
    params: { name },
    request: new Request(`http://test/api/v1/sidecar/${name}/batch`, {
      method: 'POST',
      body,
    }),
  } as any);
}

async function jsonl(response: Response) {
  const text = await response.text();
  return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-api-'));
  originalSidecarDir = config.sidecarDir;
  config.sidecarDir = tempDir;
});

afterEach(() => {
  closeCompressedSqliteStores();
  if (originalSidecarDir === undefined) delete config.sidecarDir;
  else config.sidecarDir = originalSidecarDir;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('GET /api/v1/sidecar/:name', () => {
  it('serves the stored content', async () => {
    await store.save(md5(1), { source: 'sqlite' });

    const response = await get('dokumentai', `md5=${md5(1)}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ source: 'sqlite' });
  });

  it('404s an unknown sidecar name instead of failing on the registry lookup', async () => {
    expect((await get('nesamas', `md5=${md5(1)}`)).status).toBe(404);
  });

  it('400s a malformed md5 and 404s a key it does not have', async () => {
    expect((await get('dokumentai', 'md5=abc')).status).toBe(400);
    expect((await get('dokumentai', '')).status).toBe(400);
    expect((await get('dokumentai', `md5=${md5(9)}`)).status).toBe(404);
  });

  it('503s when SIDECAR_DIR is not configured', async () => {
    delete config.sidecarDir;
    expect((await get('dokumentai', `md5=${md5(1)}`)).status).toBe(503);
  });
});

describe('POST /api/v1/sidecar/:name/batch', () => {
  it('returns JSONL with only the keys it has', async () => {
    for (const i of [1, 2, 3]) await store.save(md5(i), { i });

    const response = await post('dokumentai', JSON.stringify([md5(1), md5(2), md5(7)]));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');

    const lines = await jsonl(response);
    expect(lines.map((line) => line.md5).sort()).toEqual([md5(1), md5(2)].sort());
    expect(JSON.parse(lines[0].turinys)).toEqual({ i: Number(lines[0].md5.replace(/^0+/, '')) });
  });

  it('accepts one md5 per line as well as a JSON array', async () => {
    await store.save(md5(1), { i: 1 });

    const lines = await jsonl(await post('dokumentai', `${md5(1)}\n${md5(8)}\n`));
    expect(lines.map((line) => line.md5)).toEqual([md5(1)]);
  });

  it('streams more keys than one chunk and never repeats a duplicate', async () => {
    const keys = Array.from({ length: 120 }, (_, i) => md5(i + 1));
    for (const key of keys) await store.save(key, { key });

    const lines = await jsonl(await post('dokumentai', JSON.stringify([...keys, keys[0]])));
    expect(lines).toHaveLength(keys.length);
    expect(new Set(lines.map((line) => line.md5)).size).toBe(keys.length);
  });

  it('400s over the batch limit, on a bad md5 and on a non-array body', async () => {
    const tooMany = Array.from({ length: SIDECAR_BATCH_LIMIT + 1 }, (_, i) => md5(i + 1));
    expect((await post('dokumentai', JSON.stringify(tooMany))).status).toBe(400);
    expect((await post('dokumentai', JSON.stringify([md5(1), 'abc']))).status).toBe(400);
    expect((await post('dokumentai', '[nope')).status).toBe(400);
  });

  it('404s an unknown sidecar name', async () => {
    expect((await post('nesamas', JSON.stringify([md5(1)]))).status).toBe(404);
  });

  it('503s when SIDECAR_DIR is not configured', async () => {
    delete config.sidecarDir;
    expect((await post('dokumentai', JSON.stringify([md5(1)]))).status).toBe(503);
  });
});
