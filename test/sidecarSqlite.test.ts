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
import { SIDECAR_DBS, sidecarDbPath } from '../utils/sidecarPaths.js';
import { missingFromBatch } from '../modules/sidecars/sqliteMissing.js';
import {
  prepareFailaiFs,
  readFailaiFs,
  savePreparedFailaiFs,
} from '../modules/failai/failaiFs.js';
import { readDocumentFs, saveDocumentFs } from '../modules/documents/documentsFs.js';
import { readRezultatasFs, saveRezultatasFs } from '../modules/ocr/rezultataiFs.js';

const KEY = '0123456789abcdef0123456789abcdef';
let tempDir: string;
let originalSidecarDir: string | undefined;
let originalSidecarRemote: string | undefined;

// Bendram elgesiui tikrinti imam tikrą registro vardą — išgalvotų nebėra,
// nes kelias ir lentelė išvedami iš registro.
function store() {
  return createSidecarStore({ sidecar: 'dokumentai', label: 'testo' });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-sqlite-'));
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

describe('sidecar registras', () => {
  it('derives every path from the name inside one flat directory', () => {
    config.sidecarDir = tempDir;
    for (const name of Object.keys(SIDECAR_DBS)) {
      expect(sidecarDbPath(name)).toBe(path.join(tempDir, `${name}.sqlite`));
    }
  });

  it('has no path without SIDECAR_DIR and rejects unknown names', () => {
    expect(sidecarDbPath('dokumentai')).toBeNull();
    expect(() => sidecarDbPath('nesamas')).toThrow('Nežinomas sidecar');
  });
});

describe('SQLite sidecar backend', () => {
  it('requires SQLite for every write', async () => {
    const subject = store();
    await expect(subject.save(KEY, { source: 'legacy' }))
      .rejects.toThrow('SIDECAR_DIR nenustatytas');
  });

  it('reads from the remote endpoint when local SQLite has no value', async () => {
    const subject = store();
    config.sidecarRemote = 'https://sidecars.example.test';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: 'http' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    expect(await subject.read(KEY)).toEqual({ source: 'http' });
    expect(fetchMock).toHaveBeenCalledWith(
      `https://sidecars.example.test/api/v1/sidecar/dokumentai?md5=${KEY}`,
    );
  });

  it('writes compressed SQLite and gives it priority over HTTP', async () => {
    const subject = store();
    config.sidecarRemote = 'https://sidecars.example.test';
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ source: 'http' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    config.sidecarDir = tempDir;
    const dbPath = path.join(tempDir, 'dokumentai.sqlite');

    expect(fs.existsSync(dbPath)).toBe(false);
    await subject.save(KEY, { source: 'sqlite', text: 'kartojamas '.repeat(100) });

    expect(await subject.read(KEY)).toEqual({ source: 'sqlite', text: 'kartojamas '.repeat(100) });
    expect(fetchMock).not.toHaveBeenCalled();

    const db = new DatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT dydis, suspaustas, turinys FROM dokumentai WHERE hash = ?').get(KEY) as any;
    expect(row.suspaustas).toBeLessThan(row.dydis);
    expect(JSON.parse(zstdDecompressSync(row.turinys).toString('utf8')).source).toBe('sqlite');
    db.close();

    closeCompressedSqliteStores();
    expect(await subject.read(KEY)).toEqual({ source: 'sqlite', text: 'kartojamas '.repeat(100) });
  });

  it('does not fall back to HTTP after a configured SQLite write error', async () => {
    const subject = store();
    config.sidecarRemote = 'https://sidecars.example.test';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    config.sidecarDir = tempDir;
    // Katalogo negalima atidaryti kaip DB failo.
    fs.mkdirSync(path.join(tempDir, 'dokumentai.sqlite'));

    await expect(subject.save(KEY, { source: 'broken' })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('groups concurrent durable writes without losing rows', async () => {
    const subject = store();
    config.sidecarDir = tempDir;
    const keys = Array.from({ length: 24 }, (_, i) => i.toString(16).padStart(32, '0'));

    await Promise.all(keys.map((key, i) => subject.save(key, { i })));

    await expect(Promise.all(keys.map((key) => subject.read(key))))
      .resolves.toEqual(keys.map((_, i) => ({ i })));
  });

  it('reads a batch in one query and skips keys it does not have', async () => {
    const subject = store();
    config.sidecarDir = tempDir;
    const keys = Array.from({ length: 6 }, (_, i) => i.toString(16).padStart(32, '0'));
    for (const key of keys.slice(0, 4)) await subject.save(key, { key });

    const found = await subject.readLocalManyRaw(keys);
    expect([...found.keys()].sort()).toEqual(keys.slice(0, 4).sort());
    expect(JSON.parse(found.get(keys[0])!)).toEqual({ key: keys[0] });
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

  it('audits a table whose key column is md5, like the eTar sidecar', () => {
    const db = new DatabaseSync(path.join(tempDir, 'etar.sqlite'));
    ensureCompressedSidecarSchema(db, 'eTarAtsakymai', 'md5');
    const keys = Array.from({ length: 4 }, (_, i) => i.toString(16).padStart(32, '0'));
    const insert = db.prepare(
      'INSERT INTO "eTarAtsakymai" (md5, dydis, suspaustas, turinys) VALUES (?, 1, 1, ?)',
    );
    for (const md5 of keys.slice(0, 2)) insert.run(md5, Buffer.from('x'));

    expect(missingFromBatch(db, 'eTarAtsakymai', keys, 'md5')).toEqual(keys.slice(2));
    db.close();
  });

  it('reads eTar through the shared store exactly as the writer-side readResponse does', async () => {
    config.sidecarDir = tempDir;
    const { openETarSidecar, saveResponse, readResponse, readETarSidecar, readETarSidecarMany } =
      await import('../modules/eTar/eTarSidecar.js');

    // Rašom senuoju keliu (scraper'io pusė), skaitom nauju (store'as).
    const db = openETarSidecar();
    const atsakymas = { official_text: { text: 'Aktas' }, fetched_at: 'nepastovus' };
    const md5 = saveResponse(db, atsakymas);

    expect(await readETarSidecar(md5)).toEqual(readResponse(db, md5));
    // `fetched_at` išmetamas prieš skaičiuojant md5 – to store'as keisti neturi.
    expect(await readETarSidecar(md5)).toEqual({ official_text: { text: 'Aktas' } });

    const many = await readETarSidecarMany([md5, '0'.repeat(32)]);
    expect([...many.keys()]).toEqual([md5]);
    db.close();
  });

  it('connects failaiInfo, dokumentai and OCR wrappers to separate databases', async () => {
    config.sidecarDir = tempDir;

    const failai = prepareFailaiFs({ tekstas: 'failas', metaduomenys: { author: 'A' } });
    await savePreparedFailaiFs(failai.hash, failai.json);
    await saveDocumentFs(KEY, { md5: KEY, text: 'dokumentas' });
    await saveRezultatasFs({ md5: KEY, tekstas: ['ocr'] });

    expect(await readFailaiFs(failai.hash)).toEqual({ tekstas: 'failas', metaduomenys: { author: 'A' } });
    expect(await readDocumentFs(KEY)).toEqual({ md5: KEY, text: 'dokumentas' });
    expect(await readRezultatasFs(KEY)).toEqual({ md5: KEY, tekstas: ['ocr'] });

    // Kiekvienas store'as – atskiras failas, kad rašytojai nesirikiuotų prie vieno WAL.
    for (const name of ['failaiInfo', 'dokumentai', 'ocrRezultatai'] as const) {
      const db = new DatabaseSync(path.join(tempDir, `${name}.sqlite`), { readOnly: true });
      expect((db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get() as any).c).toBe(1);
      db.close();
    }
  });
});
