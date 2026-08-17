import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '@/utils/config.js';
import { createSidecarStore } from '@/utils/sidecarStore.js';
import { closeCompressedSqliteStores } from '@/utils/sqliteSidecarStore.js';
import { SIDECAR_BATCH_LIMIT } from '@/utils/sidecarPaths.js';

// Skaitymo grupavimas: raktai, paleisti tame pačiame tick'e, turi virsti viena
// užklausa — lokaliai vienu `json_each`, nuotoliniu atveju vienu POST.

const md5 = (i: number) => i.toString(16).padStart(32, '0');
let tempDir: string;
let originalSidecarDir: string | undefined;
let originalSidecarRemote: string | undefined;

function store() {
  return createSidecarStore({ sidecar: 'dokumentai', label: 'testo' });
}

/** JSONL atsakymas, kokį grąžina batch endpoint'as. */
function ndjson(entries: [string, unknown][]) {
  return entries
    .map(([key, value]) => JSON.stringify({ md5: key, turinys: JSON.stringify(value) }))
    .join('\n');
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-batch-'));
  originalSidecarDir = config.sidecarDir;
  originalSidecarRemote = config.sidecarRemote;
  delete config.sidecarDir;
  delete config.sidecarRemote;
});

afterEach(() => {
  closeCompressedSqliteStores();
  if (originalSidecarDir === undefined) delete config.sidecarDir;
  else config.sidecarDir = originalSidecarDir;
  if (originalSidecarRemote === undefined) delete config.sidecarRemote;
  else config.sidecarRemote = originalSidecarRemote;
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('lokalus grupavimas', () => {
  it('sulieja tick\'e paleistus skaitymus į vieną partiją', async () => {
    config.sidecarDir = tempDir;
    const subject = store();
    const keys = Array.from({ length: 50 }, (_, i) => md5(i + 1));
    for (const [i, key] of keys.entries()) await subject.save(key, { i });

    const values = await Promise.all(keys.map((key) => subject.read(key)));

    expect(values).toEqual(keys.map((_, i) => ({ i })));
  });

  it('duoda tą pačią reikšmę visiems to paties rakto laukėjams', async () => {
    config.sidecarDir = tempDir;
    const subject = store();
    await subject.save(md5(1), { vienas: true });

    const values = await Promise.all([
      subject.read(md5(1)),
      subject.read(md5(1)),
      subject.read(md5(1)),
    ]);

    expect(values).toEqual([{ vienas: true }, { vienas: true }, { vienas: true }]);
  });

  it('nerastas raktas grąžina null, o ne meta klaidą', async () => {
    config.sidecarDir = tempDir;
    const subject = store();
    await subject.save(md5(1), { yra: true });

    await expect(Promise.all([subject.read(md5(1)), subject.read(md5(9))]))
      .resolves.toEqual([{ yra: true }, null]);
  });
});

describe('nuotolinis grupavimas', () => {
  it('siunčia vieną POST vietoj N GET', async () => {
    config.sidecarRemote = 'https://sidecars.example.test';
    const subject = store();
    const keys = Array.from({ length: 30 }, (_, i) => md5(i + 1));
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(ndjson(keys.map((key, i) => [key, { i }])), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const values = await Promise.all(keys.map((key) => subject.read(key)));

    expect(values).toEqual(keys.map((_, i) => ({ i })));
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sidecars.example.test/api/v1/sidecar/dokumentai/batch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual(keys);
  });

  it('vienam raktui lieka paprastas GET', async () => {
    config.sidecarRemote = 'https://sidecars.example.test';
    const subject = store();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: 'http' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await subject.read(md5(1))).toEqual({ source: 'http' });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://sidecars.example.test/api/v1/sidecar/dokumentai?md5=${md5(1)}`,
    );
  });

  it('skaido į gabalus po SIDECAR_BATCH_LIMIT', async () => {
    config.sidecarRemote = 'https://sidecars.example.test';
    const subject = store();
    const keys = Array.from({ length: SIDECAR_BATCH_LIMIT + 20 }, (_, i) => md5(i + 1));
    const fetchMock = vi.fn().mockImplementation((_url, init: any) =>
      Promise.resolve(
        new Response(ndjson(JSON.parse(init.body).map((key: string) => [key, { key }])), {
          status: 200,
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const found = await subject.readMany(keys);

    expect(found.size).toBe(keys.length);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toHaveLength(SIDECAR_BATCH_LIMIT);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toHaveLength(20);
  });

  it('klaida partijoje grąžina null visiems raktams, o ne meta', async () => {
    config.sidecarRemote = 'https://sidecars.example.test';
    const subject = store();
    const keys = [md5(1), md5(2), md5(3)];
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('tinklas krito')));

    await expect(Promise.all(keys.map((key) => subject.read(key))))
      .resolves.toEqual([null, null, null]);
  });

  it('nuotoliniu būdu ima tik tuos raktus, kurių nėra lokaliai', async () => {
    config.sidecarDir = tempDir;
    config.sidecarRemote = 'https://sidecars.example.test';
    const subject = store();
    await subject.save(md5(1), { lokalus: true });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(ndjson([[md5(2), { nuotolinis: true }], [md5(3), { nuotolinis: true }]]), {
        status: 200,
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const values = await Promise.all([md5(1), md5(2), md5(3)].map((key) => subject.read(key)));

    expect(values).toEqual([{ lokalus: true }, { nuotolinis: true }, { nuotolinis: true }]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual([md5(2), md5(3)]);
  });
});

describe('readMany', () => {
  it('grąžina tik rastus raktus ir suvienodina dublikatus', async () => {
    config.sidecarDir = tempDir;
    const subject = store();
    for (const i of [1, 2]) await subject.save(md5(i), { i });

    const found = await subject.readMany([md5(1), md5(1), md5(2), md5(7)]);

    expect([...found.keys()]).toEqual([md5(1), md5(2)]);
    expect(found.get(md5(2))).toEqual({ i: 2 });
  });

  it('be SIDECAR_DIR ir be SIDECAR_REMOTE grąžina tuščią', async () => {
    await expect(store().readMany([md5(1)])).resolves.toEqual(new Map());
  });
});
