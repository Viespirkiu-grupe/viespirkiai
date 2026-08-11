import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../modules/dokumentai/dokumentaiFs.js', () => ({
  saveDokumentasFs: vi.fn(),
}));

import { saveDokumentasFs } from '../modules/dokumentai/dokumentaiFs.js';
import { buildETarDokumentas, upsertETarBatch } from '../modules/dokumentai/upsertFromETar.js';

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
    expect(saveDokumentasFs).toHaveBeenCalledWith('abc123', built.sidecar);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (source, \"saltinioId2\") WHERE class = 'teisekura'");
    expect(params).toHaveLength(15);
    expect(params.slice(12)).toEqual(['teisekura', 'teisesAktas', 'etar']);
  });
});
