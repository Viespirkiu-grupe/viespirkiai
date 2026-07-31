import { describe, expect, it, vi } from 'vitest';
import { loadCpvaProjektai } from '../modules/cpva/loadProjektai.js';

function dbWithResults(results: any[][]) {
  const query = vi.fn();
  for (const rows of results) query.mockResolvedValueOnce({ rows });
  return { query };
}

describe('CPVA project reader', () => {
  it('prefers the legacy exact purchase-number match', async () => {
    const db = dbWithResults([
      [{ id: 1, projektoNr: 'P-1', pirkimoNrCvpis: '123456' }],
      [{ projektoNr: 'P-1', projektoPavadinimas: 'Projektas' }],
    ]);

    const rows = await loadCpvaProjektai({
      pirkimoNumeris: '123456',
      sutartiesNumeris: 'S-1',
      tiekejoKodas: '111',
      sudarymoData: '2026-01-01',
      verte: 100,
    }, db as any);

    expect(rows).toHaveLength(1);
    expect(rows[0].projektas.projektoPavadinimas).toBe('Projektas');
    expect(db.query).toHaveBeenCalledTimes(2);
    expect(String(db.query.mock.calls[0][0])).toContain('"pirkimoNrCvpis" = $1');
  });

  it('falls back to contract, supplier and date/amount matching', async () => {
    const db = dbWithResults([
      [],
      [{ id: 2, projektoNr: 'P-2', match_score: 2 }],
      [{ projektoNr: 'P-2', projektoPavadinimas: 'Naujas projektas' }],
    ]);

    const rows = await loadCpvaProjektai({
      pirkimoNumeris: '654321',
      sutartiesNumeris: ' S-2 ',
      tiekejoKodas: '111',
      papildomiTiekejaiKodai: ['222', '111'],
      sudarymoData: '2026-02-03',
      verte: 250,
    }, db as any);

    expect(rows[0].projektoNr).toBe('P-2');
    expect(db.query.mock.calls[1][1]).toEqual([
      'S-2', ['111', '222'], '2026-02-03', 250,
    ]);
    expect(String(db.query.mock.calls[1][0])).toContain('date_match = 1 OR amount_match = 1');
  });

  it('does not guess without a contract number, supplier and secondary signal', async () => {
    const db = dbWithResults([]);

    await expect(loadCpvaProjektai({ pirkimoNumeris: 'BTGS027138' }, db as any))
      .resolves.toEqual([]);
    expect(db.query).not.toHaveBeenCalled();
  });
});
