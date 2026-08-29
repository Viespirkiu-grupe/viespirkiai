import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: { query: vi.fn(), release: vi.fn() },
  readETarSidecarMany: vi.fn(),
  buildETarDokumentas: vi.fn(),
  upsertETarBatch: vi.fn(),
  deleteETarDocuments: vi.fn(),
  signalWork: vi.fn(),
}));

vi.mock('../postgres/postgres.js', () => ({
  postgres: { connect: vi.fn(async () => mocks.client) },
}));
vi.mock('../utils/log.js', () => ({ Logger: class { log() {} } }));
vi.mock('../utils/taskSignals.js', () => ({
  WORK_SIGNALS: { DOCUMENTS_INDEX_READY: 'documents.index.ready' },
  signalWork: mocks.signalWork,
}));
vi.mock('../modules/eTar/eTarSidecar.js', () => ({
  readETarSidecarMany: mocks.readETarSidecarMany,
}));
vi.mock('../modules/documents/upsertFromETar.js', () => ({
  buildETarDokumentas: mocks.buildETarDokumentas,
  upsertETarBatch: mocks.upsertETarBatch,
  deleteETarDocuments: mocks.deleteETarDocuments,
}));

import { processETarDocumentsQueue } from '../modules/documents/processETarQueue.js';

describe('processETarDocumentsQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM public."eTarDocumentsQueue"')) {
        return { rows: [
          { id: '1', documentId: '42', keitimas: 'insert' },
          { id: '2', documentId: '42', keitimas: 'patch' },
        ] };
      }
      if (sql.includes('FROM public."eTarLegalActDocument"')) {
        return { rows: [{ documentId: '42', md5: 'abc', legalActId: 'TAR.X' }] };
      }
      return { rows: [] };
    });
    mocks.readETarSidecarMany.mockResolvedValue(
      new Map([['abc', { official_text: { text: 'Tekstas' } }]]),
    );
    mocks.buildETarDokumentas.mockReturnValue({ row: { documentId: '42', md5: 'abc' }, sidecar: {} });
    mocks.upsertETarBatch.mockResolvedValue({ upserted: 1, skipped: 0 });
    mocks.deleteETarDocuments.mockResolvedValue(0);
  });

  it('deduplikuoja porciją ir ištrina eilės įrašus tik po upsert', async () => {
    await expect(processETarDocumentsQueue()).resolves.toBe(true);
    // Visa porcija — vienu skaitymu, ne po vieną raktą.
    expect(mocks.readETarSidecarMany).toHaveBeenCalledOnce();
    expect(mocks.readETarSidecarMany).toHaveBeenCalledWith(['abc']);
    expect(mocks.upsertETarBatch).toHaveBeenCalledOnce();
    const sqlCalls = mocks.client.query.mock.calls.map(([sql]) => String(sql));
    const deleteAt = sqlCalls.findIndex((sql) => sql.includes('DELETE FROM public."eTarDocumentsQueue"'));
    expect(deleteAt).toBeGreaterThan(0);
    expect(sqlCalls.indexOf('COMMIT')).toBeGreaterThan(deleteAt);
    expect(mocks.signalWork).toHaveBeenCalledWith('documents.index.ready', {
      source: 'eTarDocumentsQueue',
      count: 1,
    });
    const commitCall = sqlCalls.indexOf('COMMIT');
    expect(mocks.signalWork.mock.invocationCallOrder[0])
      .toBeGreaterThan(mocks.client.query.mock.invocationCallOrder[commitCall]);
  });

  it('rollback palieka eilę pakartojimui, jei sidecar kopijavimas nepavyksta', async () => {
    mocks.upsertETarBatch.mockRejectedValue(new Error('sidecar write failed'));
    await expect(processETarDocumentsQueue()).rejects.toThrow('sidecar write failed');
    const sqlCalls = mocks.client.query.mock.calls.map(([sql]) => String(sql));
    expect(sqlCalls).toContain('ROLLBACK');
    expect(sqlCalls.some((sql) => sql.includes('DELETE FROM public."eTarDocumentsQueue"'))).toBe(false);
    expect(mocks.signalWork).not.toHaveBeenCalled();
    expect(mocks.client.release).toHaveBeenCalledOnce();
  });
});
