import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { zstdDecompressSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import config from '../utils/config.js';
import { createSidecarStore } from '../utils/sidecarStore.js';
import {
  closeCompressedSqliteStores,
  ensureCompressedSidecarSchema,
} from '../utils/sqliteSidecarStore.js';
import { missingFromBatch } from '../modules/sidecars/sqliteMissing.js';
import {
  prepareFailaiFs,
  readFailaiFs,
  savePreparedFailaiFs,
} from '../modules/failai/failaiFs.js';
import { readDokumentasFs, saveDokumentasFs } from '../modules/dokumentai/dokumentaiFs.js';
import { readRezultatasFs, saveRezultatasFs } from '../modules/ocr/rezultataiFs.js';

const KEY = '0123456789abcdef0123456789abcdef';
let tempDir: string;
let originalSqliteLocations: Record<string, unknown>;

function store() {
  return createSidecarStore({
    locationKey: 'testLegacyLocation',
    sqliteLocationKey: 'testSqliteLocation',
    sqliteTable: 'sidecars',
    label: 'testo',
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-sqlite-'));
  originalSqliteLocations = {
    failaiInfoSqliteLocation: config.failaiInfoSqliteLocation,
    dokumentaiSqliteLocation: config.dokumentaiSqliteLocation,
    ocrRezultataiSqliteLocation: config.ocrRezultataiSqliteLocation,
  };
  delete config.testLegacyLocation;
  delete config.testSqliteLocation;
  delete config.failaiInfoSqliteLocation;
  delete config.dokumentaiSqliteLocation;
  delete config.ocrRezultataiSqliteLocation;
});

afterEach(() => {
  closeCompressedSqliteStores();
  delete config.testLegacyLocation;
  delete config.testSqliteLocation;
  for (const [key, value] of Object.entries(originalSqliteLocations)) {
    if (value === undefined) delete config[key];
    else config[key] = value;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe('SQLite sidecar backend', () => {
  it('requires SQLite for every write', async () => {
    const subject = store();
    await expect(subject.save(KEY, { source: 'legacy' }))
      .rejects.toThrow('testSqliteLocation nenustatytas');
  });

  it('reads from an HTTP endpoint when local SQLite has no value', async () => {
    const subject = store();
    config.testLegacyLocation = 'https://sidecars.example.test/read';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: 'http' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await subject.read(KEY)).toEqual({ source: 'http' });
    expect(fetchMock).toHaveBeenCalledWith(`https://sidecars.example.test/read?md5=${KEY}`);
  });

  it('ignores old local directory locations', async () => {
    const subject = store();
    config.testLegacyLocation = path.join(tempDir, 'legacy');

    expect(await subject.read(KEY)).toBeNull();
    await expect(subject.save(KEY, { source: 'legacy' }))
      .rejects.toThrow('testSqliteLocation nenustatytas');
    expect(fs.existsSync(config.testLegacyLocation as string)).toBe(false);
  });

  it('writes compressed SQLite and gives it priority over HTTP', async () => {
    const subject = store();
    config.testLegacyLocation = 'https://sidecars.example.test/read';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: 'http' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    config.testSqliteLocation = path.join(tempDir, 'sidecars.sqlite');

    expect(fs.existsSync(config.testSqliteLocation as string)).toBe(false);
    await subject.save(KEY, { source: 'sqlite', text: 'kartojamas '.repeat(100) });

    expect(await subject.read(KEY)).toEqual({ source: 'sqlite', text: 'kartojamas '.repeat(100) });
    expect(fetchMock).not.toHaveBeenCalled();

    const db = new DatabaseSync(config.testSqliteLocation as string, { readOnly: true });
    const row = db.prepare('SELECT dydis, suspaustas, turinys FROM sidecars WHERE hash = ?').get(KEY) as any;
    expect(row.suspaustas).toBeLessThan(row.dydis);
    expect(JSON.parse(zstdDecompressSync(row.turinys).toString('utf8')).source).toBe('sqlite');
    db.close();

    closeCompressedSqliteStores();
    expect(await subject.read(KEY)).toEqual({ source: 'sqlite', text: 'kartojamas '.repeat(100) });
  });

  it('does not fall back to HTTP after a configured SQLite write error', async () => {
    const subject = store();
    config.testLegacyLocation = 'https://sidecars.example.test/read';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    config.testSqliteLocation = tempDir; // katalogo negalima atidaryti kaip DB failo

    await expect(subject.save(KEY, { source: 'broken' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('groups concurrent durable writes without losing rows', async () => {
    const subject = store();
    config.testSqliteLocation = path.join(tempDir, 'batch.sqlite');
    const keys = Array.from({ length: 24 }, (_, i) => i.toString(16).padStart(32, '0'));

    await Promise.all(keys.map((key, i) => subject.save(key, { i })));

    await expect(Promise.all(keys.map((key) => subject.read(key))))
      .resolves.toEqual(keys.map((_, i) => ({ i })));
  });

  it('finds missing hashes in one indexed SQLite batch', () => {
    const db = new DatabaseSync(path.join(tempDir, 'audit.sqlite'));
    ensureCompressedSidecarSchema(db, 'sidecars');
    const keys = Array.from({ length: 5 }, (_, i) => i.toString(16).padStart(32, '0'));
    const insert = db.prepare(
      'INSERT INTO sidecars (hash, dydis, suspaustas, turinys) VALUES (?, 1, 1, ?)',
    );
    for (const hash of keys.slice(0, 3)) insert.run(hash, Buffer.from('x'));

    expect(missingFromBatch(db, 'sidecars', keys)).toEqual(keys.slice(3));
    db.close();
  });

  it('connects failaiInfo, dokumentai and OCR wrappers to separate databases', async () => {
    config.failaiInfoSqliteLocation = path.join(tempDir, 'failaiInfo.sqlite');
    config.dokumentaiSqliteLocation = path.join(tempDir, 'dokumentai.sqlite');
    config.ocrRezultataiSqliteLocation = path.join(tempDir, 'ocr.sqlite');

    const failai = prepareFailaiFs({ tekstas: 'failas', metaduomenys: { author: 'A' } });
    await savePreparedFailaiFs(failai.hash, failai.json);
    await saveDokumentasFs(KEY, { md5: KEY, text: 'dokumentas' });
    await saveRezultatasFs({ md5: KEY, tekstas: ['ocr'] });

    expect(await readFailaiFs(failai.hash)).toEqual({ tekstas: 'failas', metaduomenys: { author: 'A' } });
    expect(await readDokumentasFs(KEY)).toEqual({ md5: KEY, text: 'dokumentas' });
    expect(await readRezultatasFs(KEY)).toEqual({ md5: KEY, tekstas: ['ocr'] });

    for (const [file, table] of [
      [config.failaiInfoSqliteLocation, 'failaiInfo'],
      [config.dokumentaiSqliteLocation, 'dokumentai'],
      [config.ocrRezultataiSqliteLocation, 'ocrRezultatai'],
    ] as const) {
      const db = new DatabaseSync(file as string, { readOnly: true });
      expect((db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as any).c).toBe(1);
      db.close();
    }
  });
});
