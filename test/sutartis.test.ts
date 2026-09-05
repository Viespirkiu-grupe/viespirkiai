import { beforeEach, describe, expect, it, vi } from 'vitest';

const pgQuery = vi.fn();

vi.mock('../postgres/postgres.js', () => ({
  postgres: { query: pgQuery },
}));

describe('loadSutartis', () => {
  beforeEach(() => {
    pgQuery.mockReset();
    // Dalis užklausų paduodamos kaip prepared statement config'as ({name, text}).
    pgQuery.mockImplementation((sqlOrConfig: string | { text: string }) => {
      const sql = typeof sqlOrConfig === 'string' ? sqlOrConfig : sqlOrConfig.text;
      if (sql.includes('"vpmSutartys"."sutartys" s') && sql.includes('WHERE "sutartiesUnikalusId" = $1')) {
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
      if (sql.includes('"vpmSutartys"."atviriDuomenys"')) return Promise.resolve({ rows: [] });
      if (sql.includes('"vpmSutartys"."atviriDuomenysImp"')) return Promise.resolve({ rows: [] });
      if (sql.includes('"vpmSutartys"."sutartys" s') && sql.includes('WHERE "sutartiesUnikalusId" != $1')) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM sabis."sutartys"')) return Promise.resolve({ rows: [] });
      if (sql.includes('FROM public.files f')) return Promise.resolve({ rows: [] });
      throw new Error(`Netikėta užklausa: ${sql}`);
    });
  });

  it('nevykdo pirkimų lookup su ne skaitiniu pirkimo numeriu', async () => {
    const { loadSutartis } = await import('../src/lib/sutartis.ts');

    const sutartis = await loadSutartis(1670337988);

    expect(sutartis?.pirkimoNumeris).toBe('BTGS027138');
    const sql = pgQuery.mock.calls.map(([query]) => String(query)).join('\n');
    expect(sql).not.toContain('cvpp."archyvoSkelbimai"');
    expect(sql).not.toContain('viesiejiPirkimai');
    expect(sql).not.toContain('cpvaProjektuSutartys');
  });
});
