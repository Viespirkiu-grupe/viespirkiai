import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../modules/documents/documentsFs.js', () => ({
  saveDocumentFs: vi.fn(),
}));

import { saveDocumentFs } from '../modules/documents/documentsFs.js';
import { buildETarDokumentas, upsertETarBatch } from '../modules/documents/upsertFromETar.js';

const row = {
  documentId: 42,
  legalActId: 'TAR.ABC',
  md5: 'abc123',
  sourceUrl: 'https://www.e-tar.lt/portal/lt/legalAct/TAR.ABC/asr',
  title: 'Bandomasis teisės aktas',
  editionToken: 'token-1',
  fetchedAt: '2026-08-10T12:00:00Z',
  variantas: 'consolidated_edition',
  turinioBusena: 'provided',
};

const payload = {
  metadata: {
    status: 'GALIOJA',
    effective_from: '2026-02-02',
    fields: {
      act_type: { value: 'Įsakymas' },
      adopted_at: { value: '2026-01-30' },
      adopted_by: { value: 'Lietuvos Respublikos Seimas' },
      institution_number: { value: 'XIV-123' },
      registration_details: { value: { date: '2026-02-01', number: '2026-001' } },
      eurovoc_terms: { value: ['0436 valstybės tarnyba'] },
    },
  },
  official_text: { text: 'Aktas mini įmonę 123456789.' },
};

describe('e-TAR propagavimas į dokumentai', () => {
  beforeEach(() => vi.clearAllMocks());

  it('normalizuoja identitetą, tekstą ir facetų metadata', () => {
    const built = buildETarDokumentas(row, payload);
    expect(built.row).toMatchObject({
      documentId: '42', legalActId: 'TAR.ABC', variantas: 'consolidated_edition',
      editionToken: 'token-1', happenedAt: '2026-01-30', createdAt: '2026-02-01',
    });
    expect(built.sidecar).toMatchObject({
      class: 'teisekura', type: 'teisesAktas', source: 'etar',
      saltinioId0: 'TAR.ABC', saltinioId1: 'consolidated_edition',
      saltinioId2: '42', saltinioId3: 'token-1', jarKodai: [123456789],
      metadata: {
        rusis: 'Įsakymas', galiojimas: 'GALIOJA', prieme: 'Lietuvos Respublikos Seimas',
        turinioBusena: 'provided', istaigosNr: 'XIV-123', registracijosNr: '2026-001',
      },
    });
  });

  it('kopijuoja sidecar ir vienu bulk upsert įrašo porciją', async () => {
    const db = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    const built = buildETarDokumentas(row, payload);
    await expect(upsertETarBatch([built], db)).resolves.toEqual({ upserted: 1, skipped: 0 });
    expect(saveDocumentFs).toHaveBeenCalledWith('abc123', built.sidecar);
    const [sql, params] = db.query.mock.calls[0];
    // Tapatybė gyvena documents."sourceIds", tad vietoj vieno ON CONFLICT
    // dabar rašomos esamos, naujos ir tik tada tapatybės.
    expect(sql).toContain('documents."sourceIds"');
    expect(sql).toContain('documents.source_id($18)');
    // URL suskaidytas į protokolą, hostą ir kelią.
    expect(params[11]).toEqual(['https']);
    expect(params[12]).toEqual(['www.e-tar.lt']);
    expect(params[14]).toEqual(['/portal/lt/legalAct/TAR.ABC/asr']);
    expect(params).toHaveLength(19);
    expect(params.slice(15)).toEqual(['teisekura', 'teisesAktas', 'etar', 'lt']);
  });
});
