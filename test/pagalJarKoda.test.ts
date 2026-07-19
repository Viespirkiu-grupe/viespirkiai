import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('../postgres/postgres.js', () => ({
  postgres: { query },
}));

describe('gautiSutarciuDuomenisPagalJarKoda', () => {
  beforeEach(() => {
    query.mockReset();
    query.mockResolvedValue({ rows: [] });
  });

  it('reads frontend aggregates only from VPM tables', async () => {
    const { gautiSutarciuDuomenisPagalJarKoda } = await import(
      '../modules/sutartys/pagalJarKoda.js'
    );

    await gautiSutarciuDuomenisPagalJarKoda('123456789', { limit: 10 });

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('"vpmSutartysSumosMetai"');
    expect(sql).toContain('"vpmSutartysSumosPirkejasTiekejas"');
    expect(sql).not.toMatch(/"sutartys(?:SumosMetaiPirkejas|SumosMetaiTiekejas|SaliuSumos)"/);
  });
});
