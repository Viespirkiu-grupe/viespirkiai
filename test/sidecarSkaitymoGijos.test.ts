import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import config from '../utils/config.js';
import { createSidecarStore } from '../utils/sidecarStore.js';
import { closeCompressedSqliteStores } from '../utils/sqliteSidecarStore.js';

// Skaitymo gijų pool'as (`utils/sqliteSidecarPoolas.js`) yra tik greitaveikos
// optimizacija, tad esminis reikalavimas — rezultatas nesiskiria nuo skaitymo
// pagrindinėje gijoje.

let tempDir: string;
let originalSidecarDir: string | undefined;
let originalThreads: number;

function store() {
  return createSidecarStore({ sidecar: 'dokumentai', label: 'testo' });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-gijos-'));
  originalSidecarDir = config.sidecarDir;
  originalThreads = config.sidecarReadThreads;
  config.sidecarDir = tempDir;
  delete config.sidecarRemote;
});

afterEach(() => {
  closeCompressedSqliteStores();
  if (originalSidecarDir === undefined) delete config.sidecarDir;
  else config.sidecarDir = originalSidecarDir;
  config.sidecarReadThreads = originalThreads;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function key(i: number) {
  return i.toString(16).padStart(32, '0');
}

describe('sidecar skaitymo gijos', () => {
  it('grąžina tą patį su gijomis ir be jų', async () => {
    const subject = store();
    const keys = Array.from({ length: 25 }, (_, i) => key(i));
    for (const [i, k] of keys.entries()) await subject.save(k, { nr: i, k });

    config.sidecarReadThreads = 1;
    closeCompressedSqliteStores();
    const beGiju = await store().readManyRaw(keys);

    config.sidecarReadThreads = 4;
    closeCompressedSqliteStores();
    const suGijomis = await store().readManyRaw(keys);

    expect(suGijomis.size).toBe(keys.length);
    expect([...suGijomis.entries()].sort()).toEqual([...beGiju.entries()].sort());
  });

  it('per gijas mato ką tik įrašytus duomenis ir praleidžia nesamus raktus', async () => {
    config.sidecarReadThreads = 4;
    const subject = store();
    // Bazė sukuriama rašant, o pool'as atsiranda tik po to — tikrinam, kad
    // skaitymas nepasiduoda dėl to, jog failo dar nebuvo importo metu.
    await subject.save(key(1), { a: 1 });

    expect(await subject.read(key(1))).toEqual({ a: 1 });

    const found = await subject.readManyRaw([key(1), key(2)]);
    expect([...found.keys()]).toEqual([key(1)]);
    expect(await subject.readRaw(key(2))).toBeNull();
  });

  it('vienas raktas per gijas grąžina turinį, ne null', async () => {
    config.sidecarReadThreads = 8;
    const subject = store();
    await subject.save(key(7), { didelis: 'x'.repeat(50_000) });
    closeCompressedSqliteStores();

    expect(await store().read(key(7))).toEqual({ didelis: 'x'.repeat(50_000) });
  });
});
