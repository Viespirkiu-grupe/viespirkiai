import { beforeEach, describe, expect, it, vi } from 'vitest';

const pgQuery = vi.fn();

vi.mock('../postgres/postgres.js', () => ({
  postgres: { query: pgQuery },
}));

describe('loadSutartis', () => {
  beforeEach(() => {
    pgQuery.mockReset();
    pgQuery.mockImplementation((sql: string) => {
      if (sql.includes('FROM sutartys WHERE "sutartiesUnikalusId" = $1')) {
        return Promise.resolve({
          rows: [{
            sutartiesUnikalusId: 1670337988,
            pirkimoNumeris: 'BTGS027138',
            pavadinimas: 'Sutartis',
            perkanciojiOrganizacija: 'Pirkėjas',
            tiekejas: 'Tiekėjas',
            dokumentai: [],
            tipas: '',
          }],
        });
      }
      if (sql.includes('sutartysAtviriDuomenys')) return Promise.resolve({ rows: [] });
      if (sql.includes('sutartysAtviriDuomenysImp')) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM sutartys WHERE "sutartiesUnikalusId" != $1')) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM "sabisSutartys"')) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM failai f')) return Promise.resolve({ rows: [] });
      throw new Error(`Netikėta užklausa: ${sql}`);
    });
  });

  it('nevykdo pirkimų lookup su ne skaitiniu pirkimo numeriu', async () => {
    const { loadSutartis } = await import('../src/lib/sutartis.ts');

    const sutartis = await loadSutartis(1670337988);

    expect(sutartis?.pirkimoNumeris).toBe('BTGS027138');
    const sql = pgQuery.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).not.toContain('cvppViesiejiPirkimai');
    expect(sql).not.toContain('viesiejiPirkimai');
    expect(sql).not.toContain('cpvaProjektuSutartys');
  });
});
